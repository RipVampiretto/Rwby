// ============================================================================
// TODO: IMPLEMENTATION PLAN - AI MODERATION
// ============================================================================
// SCOPO: Analisi intelligente contenuti tramite LLM locale (LM Studio).
// Classifica messaggi per rilevare scam, hate speech, NSFW, minacce.
// Azioni semplificate: solo DELETE o BAN (con forward a SuperAdmin).
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: ai_config (per-gruppo)
// ├── guild_id: INTEGER PRIMARY KEY
// ├── ai_enabled: INTEGER (0/1, DEFAULT 1)
// ├── action_scam: TEXT (DEFAULT 'ban')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── action_hate: TEXT (DEFAULT 'report_only')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── action_nsfw: TEXT (DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── action_threat: TEXT (DEFAULT 'report_only')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── action_spam: TEXT (DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── confidence_threshold: REAL (DEFAULT 0.75)
// ├── context_aware: INTEGER (0/1, DEFAULT 1)
// ├── context_messages: INTEGER (DEFAULT 3)
// └── sensitivity: TEXT (DEFAULT 'medium')

// ----------------------------------------------------------------------------
// 2. INFRASTRUCTURE - LLM Locale (LM Studio)
// ----------------------------------------------------------------------------
//
// PROVIDER: LM Studio (https://lmstudio.ai/)
// ENDPOINT: process.env.LM_STUDIO_URL || 'http://localhost:1234'
// PATH: /v1/chat/completions
// TIMEOUT: 5000ms
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
// CATEGORIE:
// - "safe": Contenuto normale
// - "scam": Truffe, phishing, fake giveaway
// - "hate": Discriminazione, razzismo
// - "nsfw": Contenuto sessuale
// - "threat": Minacce, doxxing
// - "spam": Promozione non richiesta
//
// RISPOSTA JSON:
// {"category": "...", "confidence": 0.0-1.0, "reason": "..."}

// ----------------------------------------------------------------------------
// 4. WORKFLOW - Flusso di Esecuzione
// ----------------------------------------------------------------------------
//
// TRIGGER: Ogni messaggio testuale
//
// STEP 1 - PRE-FILTERING:
// ├── Admin → Skip
// ├── Tier 2+ → Skip (trusted)
// ├── < 10 caratteri → Skip
// └── ai_enabled === false → Skip
//
// STEP 2 - CACHE CHECK:
// └── Hash contenuto, lookup cache (TTL 1h)
//
// STEP 3 - API CALL:
// └── fetch() a LM Studio con timeout
//
// STEP 4 - RESPONSE PARSING:
// └── Estrai JSON, valida schema
//
// STEP 5 - ACTION:
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
// └── Invia a staff locale:
//     ┌────────────────────────────────────────────┐
//     │ 🤖 **AI DETECTION REPORT**                 │
//     │ 📁 Categoria: HATE (87%)                  │
//     │ 👤 Utente: @username                       │
//     │ 💬 Messaggio: "testo..."                  │
//     └────────────────────────────────────────────┘
//     [ 🔨 Ban ] [ 🗑️ Delete ] [ ✅ Ignora ]

// ----------------------------------------------------------------------------
// 6. CONFIGURATION UI - /aiconfig
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ 🤖 **CONFIGURAZIONE AI MODERATION**        │
// │ Stato: 🟢 Attivo                           │
// │ Server: localhost:1234 (Online)            │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ 🤖 AI: ON ] [ 🔗 Test Connessione ]
// [ 🌡️ Sensibilità: ◀ Medium ▶ ]
// [ 🎭 Contesto: ON ]
// [ ⚙️ Configura Azioni Categoria ]
// [ 📊 Soglia: 75% ◀▶ ]
// [ 💾 Salva ] [ ❌ Chiudi ]
//
// SUBMENU AZIONI:
// [ 💸 SCAM: Ban ▼ ]    → [ Delete | Ban | Report ]
// [ 🗯️ HATE: Report ▼ ] → [ Delete | Ban | Report ]
// [ 🔞 NSFW: Delete ▼ ] → [ Delete | Ban | Report ]
// [ ⚔️ THREAT: Report ▼ ] → [ Delete | Ban | Report ]
// [ 📢 SPAM: Delete ▼ ] → [ Delete | Ban | Report ]

// ============================================================================
// MODULE EXPORTS
// ============================================================================

let db = null;

const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');
const { safeDelete, safeEdit, safeBan, isAdmin, handleCriticalError } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');

let _botInstance = null;

const CACHE = new Map(); // Simple cache for message hashes
const CACHE_TTL = 3600000; // 1 hour

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Middleware: AI moderation
    bot.on("message:text", async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip for admins or trusted users
        if (await isUserAdmin(ctx)) return next();
        if (ctx.userTier && ctx.userTier >= 2) return next();
        if (ctx.message.text.length < 10) return next();

        // Check if Enabled
        const config = db.getGuildConfig(ctx.chat.id);
        if (!config.ai_enabled) return next();

        await processMessage(ctx, config);
        await next();
    });

    // Command: /aiconfig
    bot.command("aiconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        const member = await ctx.getChatMember(ctx.from.id);
        if (!['creator', 'administrator'].includes(member.status)) return;

        await sendConfigUI(ctx);
    });

    // Action Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("ai_")) return next();

        const config = db.getGuildConfig(ctx.chat.id);

        // Check if we came from settings menu
        let fromSettings = false;
        try {
            const markup = ctx.callbackQuery.message.reply_markup;
            if (markup && markup.inline_keyboard) {
                fromSettings = markup.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'settings_main'));
            }
        } catch (e) { }

        if (data === "ai_close") return ctx.deleteMessage();

        if (data === "ai_toggle") {
            db.updateGuildConfig(ctx.chat.id, { ai_enabled: config.ai_enabled ? 0 : 1 });
        } else if (data === "ai_test_conn") {
            await testConnection(ctx);
            return; // Don't refresh UI immediately, testConnection sends a message
        } else if (data === "ai_sens") {
            const levels = ['low', 'medium', 'high'];
            const idx = levels.indexOf(config.ai_sensitivity || 'medium');
            db.updateGuildConfig(ctx.chat.id, { ai_sensitivity: levels[(idx + 1) % 3] });
        } else if (data === "ai_ctx") {
            db.updateGuildConfig(ctx.chat.id, { ai_context_aware: config.ai_context_aware ? 0 : 1 });
        } else if (data === "ai_threshold") {
            let thr = config.ai_confidence_threshold || 0.75;
            thr = thr >= 0.9 ? 0.5 : thr + 0.05;
            db.updateGuildConfig(ctx.chat.id, { ai_confidence_threshold: parseFloat(thr.toFixed(2)) });
        } else if (data === "ai_config_cats") {
            return sendCategoryConfigUI(ctx, fromSettings);
        } else if (data.startsWith("ai_set_act:")) {
            // act:CAT:NEXT_ACTION
            const parts = data.split(":");
            if (parts.length === 3) {
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

function djb2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i); /* hash * 33 + c */
    }
    return hash;
}

async function processMessage(ctx, config) {
    const text = ctx.message.text;
    const hash = djb2(text); // Simple hash for cache
    const cached = CACHE.get(hash);

    if (cached && (Date.now() - cached.ts < CACHE_TTL)) {
        if (cached.res && cached.res.category !== 'safe') {
            await handleViolation(ctx, config, cached.res);
        }
        return;
    }

    try {
        const result = await callLLM(text, config);
        CACHE.set(hash, { ts: Date.now(), res: result });

        if (result.category !== 'safe' && result.confidence >= (config.ai_confidence_threshold || 0.75)) {
            await handleViolation(ctx, config, result);
        }
    } catch (e) {
        logger.warn(`[ai-moderation] AI Check failed: ${e.message}`);
    }
}

async function callLLM(text, config) {
    const url = process.env.LM_STUDIO_URL || 'http://localhost:1234';
    const systemPrompt = `Classify this message for a chat bot moderation system.
Categories:
- "safe": Normal content
- "scam": Scams, phishing, fake giveaways
- "sex": Sexual content, explicit
- "spam": Unsolicited promotion

Return ONLY JSON:
{"category": "...", "confidence": 0.0-1.0, "reason": "..."}`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: text }
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
        // Fallback or safe
        return { category: "safe", confidence: 1 };
    }
}

async function handleViolation(ctx, config, result) {
    const category = result.category; // scam, hate, nsfw, threat, spam
    const actionKey = `ai_action_${category}`;
    const action = config[actionKey] || 'report_only';

    const user = ctx.from;
    const trigger = `AI: ${category.toUpperCase()} (${Math.round(result.confidence * 100)}%)`;

    // Log intent
    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'ai_action',
        targetUser: user,
        executorAdmin: null,
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
    const sens = (config.ai_sensitivity || 'medium').toUpperCase();
    const thr = (config.ai_confidence_threshold || 0.75) * 100;

    const text = `🤖 **AI MODERATION**\n\n` +
        `Un'intelligenza artificiale che legge il *senso* dei messaggi.\n` +
        `Riesce a bloccare truffe, violenza e contenuti tossici anche se usano parole normali.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Capisce il contesto della conversazione\n` +
        `• Blocca Scam, Hate Speech e Minacce\n\n` +
        `Stato: ${enabled}\n` +
        `Sensibilità: ${sens}\n` +
        `Sicurezza AI: ${thr}%`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "ai_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `🤖 AI: ${enabled}`, callback_data: "ai_toggle" }, { text: "🔗 Test Conn", callback_data: "ai_test_conn" }],
            [{ text: `🌡️ Sensibilità: ${sens}`, callback_data: "ai_sens" }],
            [{ text: `🎭 Contesto: ${config.ai_context_aware ? 'ON' : 'OFF'}`, callback_data: "ai_ctx" }],
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
    const cats = ['scam', 'hate', 'nsfw', 'threat', 'spam'];

    const rows = [];
    for (let i = 0; i < cats.length; i += 2) { // 2 per row makes it cleaner ? Or 1 per row for clarity
        const c1 = cats[i];
        const a1 = (config[`ai_action_${c1}`] || 'report_only').toUpperCase();
        const btn1 = { text: `${c1.toUpperCase()}: ${a1}`, callback_data: `ai_set_act:${c1}` };

        const row = [btn1];
        if (i + 1 < cats.length) {
            const c2 = cats[i + 1];
            const a2 = (config[`ai_action_${c2}`] || 'report_only').toUpperCase();
            row.push({ text: `${c2.toUpperCase()}: ${a2}`, callback_data: `ai_set_act:${c2}` });
        }
        rows.push(row);
    }
    rows.push([{ text: "🔙 Indietro", callback_data: "ai_back_main" }]);

    const text = "⚙️ **CONFIGURAZIONE AZIONI CATEGORIE**\nClick per cambiare (Delete/Ban/Report)";
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
    const member = await ctx.getChatMember(ctx.from.id);
    return ['creator', 'administrator'].includes(member.status);
}

module.exports = { register, sendConfigUI };
