// ============================================================================
// AI MODERATION MODULE
// ============================================================================
// SCOPO: Analisi intelligente contenuti tramite LLM locale (LM Studio).
// Classifica messaggi per rilevare scam, nsfw, spam.
// Funziona come "ULTIMA SPIAGGIA" - chiamato da altri moduli dopo i loro filtri.
// Azioni semplificate: solo DELETE, BAN o REPORT_ONLY.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: guild_config (campi AI Moderation)
// ├── ai_enabled: INTEGER (0/1, DEFAULT 1)
// ├── ai_action_scam: TEXT (DEFAULT 'ban')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── ai_action_nsfw: TEXT (DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── ai_action_spam: TEXT (DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── ai_confidence_threshold: REAL (DEFAULT 0.75)
// ├── ai_context_aware: INTEGER (0/1, DEFAULT 1)
// ├── ai_context_messages: INTEGER (DEFAULT 3)
// └── ai_tier_bypass: INTEGER (DEFAULT 2) - Tier da cui viene ignorato
//
// NOTA: Rimossi ai_sensitivity (inutilizzato), ai_action_hate, ai_action_threat

// ----------------------------------------------------------------------------
// 2. INFRASTRUCTURE - LLM Locale (LM Studio)
// ----------------------------------------------------------------------------
//
// PROVIDER: LM Studio (https://lmstudio.ai/)
// ENDPOINT: process.env.LM_STUDIO_URL || 'http://localhost:1234'
// PATH: /v1/chat/completions
// TIMEOUT: 10000ms
//
// MODELLI CONSIGLIATI:
// 1. TheBloke/Mistral-7B-Instruct-v0.2-GGUF (Q4_K_M)
// 2. NousResearch/Hermes-2-Pro-Llama-3-8B-GGUF
// 3. microsoft/phi-2-GGUF
//
// HEALTHCHECK:
// └── Chiamata periodica a /v1/models per verificare stato

// ----------------------------------------------------------------------------
// 3. SYSTEM PROMPT - Classificazione
// ----------------------------------------------------------------------------
//
// CATEGORIE (RIDOTTE):
// - "safe": Contenuto normale
// - "scam": Truffe, phishing, fake giveaway
// - "nsfw": Contenuto sessuale
// - "spam": Promozione non richiesta
//
// RISPOSTA JSON:
// {"category": "...", "confidence": 0.0-1.0, "reason": "..."}

// ----------------------------------------------------------------------------
// 4. WORKFLOW - Flusso di Esecuzione (NUOVA ARCHITETTURA)
// ----------------------------------------------------------------------------
//
// TRIGGER: NON automatico! Chiamato esplicitamente da altri moduli.
// └── Funzione exported: analyzeMessage(ctx, contextMessages)
//
// STEP 1 - PRE-FILTERING (nel chiamante):
// ├── Admin → Skip
// ├── Tier >= ai_tier_bypass → Skip (configurabile)
// ├── < 10 caratteri → Skip
// └── ai_enabled === false → Skip
//
// STEP 2 - CONTEXT (opzionale):
// └── Se ai_context_aware, include ultimi N messaggi nel prompt
//
// STEP 3 - CACHE CHECK:
// └── Hash contenuto + contesto, lookup cache (TTL 1h)
//
// STEP 4 - API CALL:
// └── fetch() a LM Studio con timeout
//
// STEP 5 - RESPONSE PARSING:
// └── Estrai JSON, valida schema
//
// STEP 6 - ACTION:
// └── Esegui action_[category] configurata

// ----------------------------------------------------------------------------
// 5. ACTION HANDLER - Solo Delete/Ban/Report
// ----------------------------------------------------------------------------
//
// action === 'delete':
// └── ctx.deleteMessage() silenzioso
//
// action === 'ban':
// ├── ctx.deleteMessage()
// ├── ctx.banChatMember(userId)
// ├── **FORWARD A SUPERADMIN**:
// │   ┌────────────────────────────────────────────┐
// │   │ 🔨 **BAN ESEGUITO (AI)**                   │
// │   │                                            │
// │   │ 🏛️ Gruppo: Nome Gruppo                    │
// │   │ 👤 Utente: @username (ID: 123456)         │
// │   │ 🤖 AI Category: SCAM (92%)                │
// │   │ 📝 Reason: Promette guadagni irrealistici │
// │   │                                            │
// │   │ 💬 Messaggio originale:                    │
// │   │ "Guadagna 1000€ al giorno! t.me/..."      │
// │   └────────────────────────────────────────────┘
// │   [ ➕ Blacklist Link ] [ ➕ Blacklist Pattern ]
// │   [ 🌍 Global Ban ] [ ✅ Solo Locale ]
// └── Auto-delete forward dopo 24h
//
// action === 'report_only':
// ├── NON eliminare, NON bannare
// └── Invia a staff locale per review

// ----------------------------------------------------------------------------
// 6. CONFIGURATION UI - /aiconfig
// ----------------------------------------------------------------------------
//
// KEYBOARD:
// [ 🤖 AI: ON ] [ 🔗 Test Connessione ]
// [ 🎭 Contesto: ON ]
// [ 👤 Bypass Tier: 2 ]
// [ ⚙️ Configura Azioni Categoria ]
// [ 📊 Soglia: 75% ]
// [ 🔙 Back / ❌ Chiudi ]
//
// SUBMENU AZIONI (RIDOTTO):
// [ 💸 SCAM: Ban ▼ ]    → [ Delete | Ban | Report ]
// [ 🔞 NSFW: Delete ▼ ] → [ Delete | Ban | Report ]
// [ 📢 SPAM: Delete ▼ ] → [ Delete | Ban | Report ]

// ============================================================================
// MODULE EXPORTS
// ============================================================================

let db = null;

const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');
const { safeDelete, safeEdit, safeBan, isAdmin, handleCriticalError, isFromSettingsMenu } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');

let _botInstance = null;

const CACHE = new Map(); // Simple cache for message hashes
const CACHE_TTL = 3600000; // 1 hour
const CACHE_CLEANUP_INTERVAL = 600000; // 10 minutes

// In-memory context storage: Map<chatId, Array<{userId, text, ts}>>
const CONTEXT_BUFFER = new Map();
const MAX_CONTEXT_SIZE = 10; // Keep last 10 messages per chat

// Cleanup old cache entries every 10 minutes
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, value] of CACHE.entries()) {
        if (now - value.ts > CACHE_TTL) {
            CACHE.delete(key);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        logger.debug(`[ai-moderation] Cache cleanup: removed ${cleaned} expired entries, ${CACHE.size} remaining`);
    }
}, CACHE_CLEANUP_INTERVAL);

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Context collector middleware - stores recent messages for context
    bot.on("message:text", async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Store message in context buffer
        const chatId = ctx.chat.id;
        if (!CONTEXT_BUFFER.has(chatId)) {
            CONTEXT_BUFFER.set(chatId, []);
        }
        const buffer = CONTEXT_BUFFER.get(chatId);
        buffer.push({
            userId: ctx.from.id,
            username: ctx.from.username || ctx.from.first_name,
            text: ctx.message.text,
            ts: Date.now()
        });
        // Keep only last MAX_CONTEXT_SIZE messages
        if (buffer.length > MAX_CONTEXT_SIZE) {
            buffer.shift();
        }

        await next();
    });

    // Command: /aiconfig
    bot.command("aiconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        if (!await isAdmin(ctx, 'ai-moderation')) return;

        await sendConfigUI(ctx);
    });

    // Command: /testai <message> - Admin only, test AI analysis
    bot.command("testai", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        if (!await isAdmin(ctx, 'ai-moderation')) return;

        const text = ctx.message.text.replace(/^\/testai\s*/, '').trim();
        if (!text) {
            await ctx.reply("⚠️ Uso: `/testai <messaggio da analizzare>`", { parse_mode: 'Markdown' });
            return;
        }

        await ctx.reply("🔄 Analisi in corso...");

        try {
            const config = db.getGuildConfig(ctx.chat.id);
            const result = await callLLM(text, [], config);

            const emoji = result.category === 'safe' ? '✅' : '🚨';
            const response = `${emoji} **RISULTATO AI**\n\n` +
                `📁 Categoria: \`${result.category}\`\n` +
                `📊 Confidenza: \`${Math.round(result.confidence * 100)}%\`\n` +
                `📝 Motivo: ${result.reason}\n\n` +
                `🔧 Soglia attuale: ${(config.ai_confidence_threshold || 0.75) * 100}%\n` +
                `⚡ Azione se rilevato: \`${config['ai_action_' + result.category] || 'N/A'}\``;

            await ctx.reply(response, { parse_mode: 'Markdown' });
        } catch (e) {
            await ctx.reply(`❌ Errore: ${e.message}`);
        }
    });

    // Action Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("ai_")) return next();

        const config = db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === "ai_close") return ctx.deleteMessage();

        if (data === "ai_toggle") {
            db.updateGuildConfig(ctx.chat.id, { ai_enabled: config.ai_enabled ? 0 : 1 });
        } else if (data === "ai_test_conn") {
            await testConnection(ctx);
            return; // Don't refresh UI immediately, testConnection sends a message
        } else if (data === "ai_ctx") {
            db.updateGuildConfig(ctx.chat.id, { ai_context_aware: config.ai_context_aware ? 0 : 1 });
        } else if (data === "ai_tier_bypass") {
            // Cycle through 0, 1, 2, 3
            const current = config.ai_tier_bypass ?? 2;
            const next = (current + 1) % 4;
            db.updateGuildConfig(ctx.chat.id, { ai_tier_bypass: next });
        } else if (data === "ai_threshold") {
            let thr = config.ai_confidence_threshold || 0.75;
            thr = thr >= 0.9 ? 0.5 : thr + 0.05;
            db.updateGuildConfig(ctx.chat.id, { ai_confidence_threshold: parseFloat(thr.toFixed(2)) });
        } else if (data === "ai_config_cats") {
            return sendCategoryConfigUI(ctx, fromSettings);
        } else if (data.startsWith("ai_set_act:")) {
            // act:CAT:NEXT_ACTION
            const parts = data.split(":");
            if (parts.length === 2) {
                const cat = parts[1];
                const key = `ai_action_${cat}`;
                // Actions: delete, ban, report_only
                const actions = ['delete', 'ban', 'report_only'];
                let current = config[key] || 'report_only';
                if (!actions.includes(current)) current = 'report_only';
                const nextAct = actions[(actions.indexOf(current) + 1) % 3];
                db.updateGuildConfig(ctx.chat.id, { [key]: nextAct });
                return sendCategoryConfigUI(ctx, fromSettings); // Stay in sub-menu
            }
        } else if (data === "ai_back_main") {
            return sendConfigUI(ctx, true, fromSettings);
        }

        await sendConfigUI(ctx, true, fromSettings);
    });
}

// ============================================================================
// EXPORTED FUNCTION - Called by other modules as "last resort"
// ============================================================================

/**
 * Analyze a message using AI as a last resort filter.
 * Should be called by other modules after their own checks pass.
 * 
 * @param {Context} ctx - Telegram context
 * @returns {Promise<{triggered: boolean, result: object|null}>}
 */
async function analyzeMessage(ctx) {
    if (!db) {
        logger.warn('[ai-moderation] analyzeMessage called but module not initialized');
        return { triggered: false, result: null };
    }

    const config = db.getGuildConfig(ctx.chat.id);

    // Check if enabled
    if (!config.ai_enabled) {
        return { triggered: false, result: null };
    }

    // Check tier bypass
    const tierBypass = config.ai_tier_bypass ?? 2;
    if (ctx.userTier !== undefined && ctx.userTier >= tierBypass) {
        return { triggered: false, result: null };
    }

    // Check admin bypass
    if (await isUserAdmin(ctx)) {
        return { triggered: false, result: null };
    }

    // Check minimum length
    const text = ctx.message?.text;
    if (!text || text.length < 10) {
        return { triggered: false, result: null };
    }

    // Get context messages if enabled
    let contextMessages = [];
    if (config.ai_context_aware) {
        const numContext = config.ai_context_messages || 3;
        const buffer = CONTEXT_BUFFER.get(ctx.chat.id) || [];
        // Get last N messages excluding current one
        contextMessages = buffer.slice(-numContext - 1, -1);
    }

    // Process with AI
    try {
        const result = await processWithAI(text, contextMessages, config);

        if (result.category !== 'safe' && result.confidence >= (config.ai_confidence_threshold || 0.75)) {
            await handleViolation(ctx, config, result);
            return { triggered: true, result: result };
        }

        return { triggered: false, result: result };
    } catch (e) {
        logger.warn(`[ai-moderation] AI Check failed: ${e.message}`);
        return { triggered: false, result: null };
    }
}

function djb2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i); /* hash * 33 + c */
    }
    return hash;
}

async function processWithAI(text, contextMessages, config) {
    // Create cache key including context
    const contextStr = contextMessages.map(m => m.text).join('|');
    const hash = djb2(text + contextStr);
    const cached = CACHE.get(hash);

    if (cached && (Date.now() - cached.ts < CACHE_TTL)) {
        return cached.res;
    }

    const result = await callLLM(text, contextMessages, config);
    CACHE.set(hash, { ts: Date.now(), res: result });

    return result;
}

async function callLLM(text, contextMessages, config) {
    const url = process.env.LM_STUDIO_URL || 'http://localhost:1234';

    // Build context string
    let contextStr = '';
    if (contextMessages.length > 0) {
        contextStr = '\n\nPrevious messages for context:\n' +
            contextMessages.map(m => `[${m.username}]: ${m.text}`).join('\n');
    }

    const systemPrompt = `You are a chat moderation AI. Classify the user's message for a Telegram group moderation bot.

Categories (choose ONE):
- "safe": Normal, acceptable content
- "scam": Scams, phishing, fake giveaways, crypto schemes, money-making promises
- "nsfw": Sexual content, explicit material
- "spam": Unsolicited promotion, advertising, repetitive content

Respond with ONLY a JSON object:
{"category": "...", "confidence": 0.0-1.0, "reason": "brief explanation"}`;

    const userMessage = text + contextStr;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: process.env.LM_STUDIO_MODEL || undefined, // Use specific model if set
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage }
                ],
                temperature: 0.1,
                max_tokens: 150
            }),
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) throw new Error("API Error");
        const data = await response.json();
        const content = data.choices[0].message.content;

        // Extract JSON from markdown code block if present
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
        return JSON.parse(content);

    } catch (e) {
        // Fallback to safe
        logger.debug(`[ai-moderation] LLM call failed: ${e.message}`);
        return { category: "safe", confidence: 1 };
    }
}

async function handleViolation(ctx, config, result) {
    const category = result.category; // scam, nsfw, spam
    const actionKey = `ai_action_${category}`;
    const action = config[actionKey] || 'report_only';

    const user = ctx.from;
    const trigger = `AI: ${category.toUpperCase()} (${Math.round(result.confidence * 100)}%)`;

    // Determine eventType based on action
    const eventType = action === 'ban' ? 'ai_ban' : 'ai_delete';

    // Log intent
    const logParams = {
        guildId: ctx.chat.id,
        eventType: eventType,
        targetUser: user,
        reason: `${trigger} - ${result.reason}`,
        isGlobal: (action === 'ban')
    };

    if (action === 'delete') {
        await safeDelete(ctx, 'ai-moderation');
        if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
    }
    else if (action === 'ban') {
        await safeDelete(ctx, 'ai-moderation');
        const banned = await safeBan(ctx, user.id, 'ai-moderation');

        if (banned) {
            await ctx.reply(`🚫 **BANNED (AI)**\nReason: ${category}`);
            userReputation.modifyFlux(user.id, ctx.chat.id, -100, `ai_ban_${category}`);

            if (superAdmin.forwardBanToParliament) {
                superAdmin.forwardBanToParliament({
                    user: user,
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: `${trigger}\nExplanation: ${result.reason}`,
                    evidence: ctx.message.text,
                    flux: userReputation.getLocalFlux(user.id, ctx.chat.id)
                });
            }

            logParams.eventType = 'ban';
            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
        }
    }
    else { // report_only
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'AI-Moderation',
            user: user,
            reason: `${trigger}\nReason: ${result.reason}`,
            messageId: ctx.message.message_id,
            content: ctx.message.text
        });
    }
}

async function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.ai_enabled ? '✅ ON' : '❌ OFF';
    const tierBypass = config.ai_tier_bypass ?? 2;
    const thr = (config.ai_confidence_threshold || 0.75) * 100;

    const text = `🤖 **AI MODERATION**\n\n` +
        `Un'intelligenza artificiale che legge il *senso* dei messaggi.\n` +
        `Riesce a bloccare truffe e contenuti tossici anche se usano parole normali.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Funziona come "ultima spiaggia" dopo altri filtri\n` +
        `• Capisce il contesto della conversazione\n` +
        `• Blocca Scam, NSFW e Spam\n\n` +
        `Stato: ${enabled}\n` +
        `Bypass da Tier: ${tierBypass}+\n` +
        `Soglia Confidenza: ${thr}%`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "ai_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `🤖 AI: ${enabled}`, callback_data: "ai_toggle" }],
            [{ text: `🎭 Contesto: ${config.ai_context_aware ? 'ON' : 'OFF'}`, callback_data: "ai_ctx" }],
            [{ text: `👤 Bypass Tier: ${tierBypass}+`, callback_data: "ai_tier_bypass" }],
            [{ text: "⚙️ Configura Azioni Categoria", callback_data: "ai_config_cats" }],
            [{ text: `📊 Soglia: ${thr}%`, callback_data: "ai_threshold" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        try { await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' }); } catch (e) { }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

async function sendCategoryConfigUI(ctx, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const cats = ['scam', 'nsfw', 'spam']; // Reduced categories

    const rows = [];
    for (const cat of cats) {
        const action = (config[`ai_action_${cat}`] || 'report_only').toUpperCase().replace('_', ' ');
        rows.push([{ text: `${cat.toUpperCase()}: ${action}`, callback_data: `ai_set_act:${cat}` }]);
    }
    rows.push([{ text: "🔙 Indietro", callback_data: "ai_back_main" }]);

    const text = "⚙️ **AZIONI PER CATEGORIA**\nClick per cambiare (Delete/Ban/Report)";
    try {
        await ctx.editMessageText(text, { reply_markup: { inline_keyboard: rows }, parse_mode: 'Markdown' });
    } catch (e) { }
}

async function testConnection(ctx) {
    try {
        const url = process.env.LM_STUDIO_URL || 'http://localhost:1234';
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        await fetch(`${url}/v1/models`, { signal: controller.signal });
        clearTimeout(timeout);
        await ctx.reply("✅ Connessione LM Studio con successo!");
    } catch (e) {
        await ctx.reply(`❌ Errore connessione LM Studio: ${e.message}`);
    }
}

async function isUserAdmin(ctx) {
    try {
        const member = await ctx.getChatMember(ctx.from.id);
        return ['creator', 'administrator'].includes(member.status);
    } catch (e) {
        return false;
    }
}

module.exports = { register, sendConfigUI, analyzeMessage };
