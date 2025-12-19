// ============================================================================
// TODO: IMPLEMENTATION PLAN - KEYWORD MONITOR (Blacklist)
// ============================================================================
// SCOPO: Filtro parole/frasi vietate con supporto regex.
// Ogni parola può avere azione indipendente.
// Azioni semplificate: solo DELETE o BAN (con forward a SuperAdmin).
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: word_filters
// ├── id: INTEGER PRIMARY KEY AUTOINCREMENT
// ├── guild_id: INTEGER (0 = globale da IntelNetwork)
// ├── word: TEXT (stringa o pattern regex)
// ├── is_regex: INTEGER (0/1)
// ├── action: TEXT (DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── category: TEXT ('spam', 'hate', 'nsfw', 'custom')
// ├── severity: INTEGER (1-5, priorità matching)
// ├── match_whole_word: INTEGER (0/1)
// ├── bypass_tier: INTEGER (DEFAULT 2)
// └── created_at: TEXT (ISO timestamp)

// ----------------------------------------------------------------------------
// 2. MATCHING LOGIC - Rilevamento
// ----------------------------------------------------------------------------
//
// STEP 1: Fetch filtri locali + globali
// STEP 2: Normalizza testo (lowercase, rimuovi accenti)
// STEP 3: Per ogni filtro:
//         - regex → test()
//         - whole_word → \\b{word}\\b
//         - else → includes()
// STEP 4: Prima match → esegui action

// ----------------------------------------------------------------------------
// 3. ACTION HANDLER - Solo Delete/Ban/Report
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
// │   │ 🔨 **BAN ESEGUITO (Keyword)**              │
// │   │ 🏛️ Gruppo: Nome                           │
// │   │ 👤 Utente: @username                       │
// │   │ 🎯 Keyword: "parola_vietata"              │
// │   │ 📁 Categoria: HATE                        │
// │   │ 💬 "messaggio con parola_vietata..."      │
// │   └────────────────────────────────────────────┘
// │   [ ➕ Blacklist Globale ] [ 🌍 Global Ban ]
// └── Auto-delete forward dopo 24h
//
// action === 'report_only':
// └── Invia a staff locale per review

// ----------------------------------------------------------------------------
// 4. CONFIGURATION UI - /wordconfig
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ 🔤 **PAROLE VIETATE**                      │
// │ Filtri: 47 (35 locali, 12 globali)        │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ ➕ Aggiungi Parola ] [ 📜 Lista ]
// [ 🌐 Sync Globale: ON ]
// [ ❌ Chiudi ]
//
// WIZARD AGGIUNGI:
// 1. "Digita parola:" → input
// 2. "Regex?" [ Sì | No ]
// 3. "Azione:" [ Delete | Ban | Report ]

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

// Temporary store for wizard sessions
const WIZARD_SESSIONS = new Map();
const WIZARD_SESSION_TTL = 300000; // 5 minutes
const WIZARD_CLEANUP_INTERVAL = 60000; // 1 minute

// Cleanup abandoned wizard sessions every minute
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, session] of WIZARD_SESSIONS.entries()) {
        if (now - (session.startedAt || 0) > WIZARD_SESSION_TTL) {
            WIZARD_SESSIONS.delete(key);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        logger.debug(`[keyword-monitor] Wizard cleanup: removed ${cleaned} expired sessions, ${WIZARD_SESSIONS.size} remaining`);
    }
}, WIZARD_CLEANUP_INTERVAL);

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Middleware: keyword detection
    bot.on("message:text", async (ctx, next) => {
        if (ctx.chat.type === 'private') {
            // Handle wizard input in DMs or Groups?
            // Usually config commands are in group. But wizard step 1 is input.
            // If we are in wizard state for this user/chat
            const sessionKey = `${ctx.from.id}:${ctx.chat.id}`;
            if (WIZARD_SESSIONS.has(sessionKey)) {
                await handleWizardStep(ctx, sessionKey);
                return; // Stop propagation
            }
            return next();
        }

        // Handle wizard in group
        const sessionKey = `${ctx.from.id}:${ctx.chat.id}`;
        if (WIZARD_SESSIONS.has(sessionKey)) {
            await handleWizardStep(ctx, sessionKey);
            return;
        }

        // Tier check logic: check bypass per rule? Or global bypass?
        // Prompt says "bypass_tier: INTEGER (DEFAULT 2)" per rule, but middleware has generic check.
        // Let's load rules and check bypass individually if needed, OR just skip high tier users entirely for performance?
        // Prompt says: "Middleware: keyword detection ... ctx.userTier >= 2 return next()".
        // So default bypass is 2.

        // Skip for admins
        if (await isAdmin(ctx, 'keyword-monitor')) return next();
        if (ctx.userTier >= 2) return next();

        await processKeywords(ctx);
        await next();
    });

    // Command: /wordconfig
    bot.command("wordconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        if (!await isAdmin(ctx, 'keyword-monitor')) return;

        await sendConfigUI(ctx);
    });

    // UI Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("wrd_")) return next();

        const fromSettings = isFromSettingsMenu(ctx);

        if (data === "wrd_close") return ctx.deleteMessage();

        if (data === "wrd_list") {
            const rules = db.getDb().prepare('SELECT * FROM word_filters WHERE guild_id = ?').all(ctx.chat.id);
            let msg = "📜 **Word Rules**\n";
            if (rules.length === 0) msg += "Nessuna regola.";
            else rules.slice(0, 20).forEach(r => msg += `- \`${r.word}\` (${r.action})\n`);

            const backBtn = fromSettings
                ? { text: "🔙 Back to Menu", callback_data: "wrd_back_main" }
                : { text: "🔙 Back", callback_data: "wrd_back" };

            try { await ctx.editMessageText(msg, { reply_markup: { inline_keyboard: [[backBtn]] }, parse_mode: 'Markdown' }); } catch (e) { }
            return;
        } else if (data === "wrd_back") {
            return sendConfigUI(ctx, true, false);
        } else if (data === "wrd_back_main") {
            return sendConfigUI(ctx, true, true);
        } else if (data === "wrd_add") {
            WIZARD_SESSIONS.set(`${ctx.from.id}:${ctx.chat.id}`, { step: 1, fromSettings: fromSettings, startedAt: Date.now() });
            await ctx.reply("✍️ Digita la parola o regex da bloccare:", { reply_markup: { force_reply: true } });
            await ctx.answerCallbackQuery();
            return;
        } else if (data.startsWith("wrd_wiz_")) {
            // Wizard callback handling (yes/no regex, action selection)
            const sessionKey = `${ctx.from.id}:${ctx.chat.id}`;
            if (!WIZARD_SESSIONS.has(sessionKey)) return ctx.answerCallbackQuery("Sessione scaduta.");

            const session = WIZARD_SESSIONS.get(sessionKey);
            if (session.step === 2) {
                if (data === "wrd_wiz_regex_yes") session.is_regex = 1;
                else session.is_regex = 0;

                session.step = 3;
                await ctx.editMessageText(`Azione per \`${session.word}\`?`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🗑️ Delete", callback_data: "wrd_wiz_act_delete" }, { text: "🔨 Ban", callback_data: "wrd_wiz_act_ban" }],
                            [{ text: "⚠️ Report", callback_data: "wrd_wiz_act_report" }]
                        ]
                    }, parse_mode: 'Markdown'
                });
            } else if (session.step === 3) {
                const act = data.split('_act_')[1];
                session.action = act;

                // Save
                db.getDb().prepare(`INSERT INTO word_filters (guild_id, word, is_regex, action, severity, match_whole_word, bypass_tier) VALUES (?, ?, ?, ?, ?, ?, ?)`)
                    .run(ctx.chat.id, session.word, session.is_regex, session.action, 3, session.is_regex ? 0 : 1, 2);

                WIZARD_SESSIONS.delete(sessionKey);
                await ctx.editMessageText(`✅ Regola aggiunta: \`${session.word}\` -> ${session.action}`, { parse_mode: 'Markdown' });
                // Return to appropriate menu using saved state
                await sendConfigUI(ctx, false, session.fromSettings || false);
            }
        }
    });
}

async function handleWizardStep(ctx, sessionKey) {
    const session = WIZARD_SESSIONS.get(sessionKey);
    if (session.step === 1 && ctx.message.text) {
        session.word = ctx.message.text;
        session.step = 2;
        await ctx.reply(`\`${session.word}\` è una Regular Expression?`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✅ Sì", callback_data: "wrd_wiz_regex_yes" }, { text: "❌ No", callback_data: "wrd_wiz_regex_no" }]
                ]
            }, parse_mode: 'Markdown'
        });
    }
}

async function processKeywords(ctx) {
    const text = ctx.message.text;
    const rules = db.getDb().prepare('SELECT * FROM word_filters WHERE guild_id = ? OR guild_id = 0').all(ctx.chat.id);

    // Sort by severity (assuming high severity first)?? Or just check all.
    // Prompt says: "Prima match -> esegui action"

    for (const rule of rules) {
        if (rule.bypass_tier && ctx.userTier >= rule.bypass_tier) continue;

        let match = false;
        if (rule.is_regex) {
            try {
                const regex = new RegExp(rule.word, 'i');
                if (regex.test(text)) match = true;
            } catch (e) { }
        } else {
            if (rule.match_whole_word) {
                const regex = new RegExp(`\\b${escapeRegExp(rule.word)}\\b`, 'i');
                if (regex.test(text)) match = true;
            } else {
                if (text.toLowerCase().includes(rule.word.toLowerCase())) match = true;
            }
        }

        if (match) {
            await executeAction(ctx, rule.action, rule.word, text);
            return; // Stop processing after first match
        }
    }
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function executeAction(ctx, action, keyword, fullText) {
    const user = ctx.from;
    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'word_filter',
        targetUser: user,
        executorAdmin: null,
        reason: `Keyword: ${keyword}`,
        isGlobal: (action === 'ban')
    };

    if (action === 'delete') {
        await safeDelete(ctx, 'keyword-monitor');
    }
    else if (action === 'ban') {
        await safeDelete(ctx, 'keyword-monitor');
        const banned = await safeBan(ctx, user.id, 'keyword-monitor');

        if (banned) {
            await ctx.reply(`🚫 **BANNED (Keyword)**\nTrigger: "||${keyword}||"`, { parse_mode: 'MarkdownV2' });
            userReputation.modifyFlux(user.id, ctx.chat.id, -50, 'keyword_ban');

            if (superAdmin.forwardBanToParliament) {
                superAdmin.forwardBanToParliament({
                    user: user,
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: `Keyword Ban: ${keyword}`,
                    evidence: fullText,
                    flux: userReputation.getLocalFlux(user.id, ctx.chat.id)
                });
            }

            logParams.eventType = 'ban';
            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
        }
    }
    else if (action === 'report_only') {
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Keyword',
            user: user,
            reason: `Keyword: ${keyword}`,
            messageId: ctx.message.message_id,
            content: fullText
        });
    }
}

async function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    const count = db.getDb().prepare('SELECT COUNT(*) as c FROM word_filters WHERE guild_id = ?').get(ctx.chat.id).c;

    const text = `🔤 **PAROLE VIETATE**\n\n` +
        `Blocca messaggi che contengono parole o frasi specifiche che non vuoi nel gruppo.\n` +
        `Puoi scegliere se cancellare o bannare chi le usa.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Puoi bloccare parole esatte o parziali\n` +
        `• Supporta regole avanzate per utenti esperti\n` +
        `• Può usare liste condivise di parole pericolose\n\n` +
        `Filtri attivi: ${count} locali`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "wrd_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: "➕ Aggiungi Parola", callback_data: "wrd_add" }, { text: "📜 Lista", callback_data: "wrd_list" }],
            [{ text: "🌐 Sync Globale: ON", callback_data: "wrd_noop" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'keyword-monitor');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = { register, sendConfigUI };
