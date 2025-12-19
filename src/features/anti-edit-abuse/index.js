// ============================================================================
// TODO: IMPLEMENTATION PLAN - ANTI-EDIT ABUSE
// ============================================================================
// SCOPO: Rilevare abusi della funzione modifica messaggio.
// Tattica scammer: messaggio innocuo → modifica con link scam.
// Azioni semplificate: solo DELETE o BAN (con forward a SuperAdmin).
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: guild_config (campi edit-abuse)
// ├── edit_monitor_enabled: INTEGER (0/1, DEFAULT 1)
// ├── edit_abuse_action: TEXT (DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── edit_lock_tier0: INTEGER (0/1, DEFAULT 1)
// │   └── Se 1, Tier 0 NON può modificare messaggi
// ├── edit_similarity_threshold: REAL (DEFAULT 0.5)
// │   └── Sotto 50% similarità → sospetto
// └── edit_link_injection_action: TEXT (DEFAULT 'ban')
//     └── Azione specifica per link injection (sempre grave)
//
// TABELLA: message_snapshots (confronto before/after)
// ├── message_id, chat_id, user_id: INTEGER
// ├── original_text: TEXT
// ├── original_has_link: INTEGER (0/1)
// ├── created_at: TEXT (ISO timestamp)
// └── edit_count: INTEGER (DEFAULT 0)

// ----------------------------------------------------------------------------
// 2. SNAPSHOT SYSTEM - Cattura Stato Originale
// ----------------------------------------------------------------------------
//
// TRIGGER: Ogni nuovo messaggio testuale
// AZIONE: Salvare snapshot con testo originale e presenza link
// CLEANUP: Cronjob ogni ora elimina snapshot > 24h

// ----------------------------------------------------------------------------
// 3. DETECTION LOGIC - Rilevamento Abusi
// ----------------------------------------------------------------------------
//
// TRIGGER: Evento 'edited_message'
//
// CHECK A - LINK INJECTION (CRITICO):
// └── original_has_link === false && new_message ha link
// └── SEVERITY: CRITICAL → edit_link_injection_action (default: ban)
//
// CHECK B - SIMILARITY:
// └── Calcolo Levenshtein distance
// └── similarity = 1 - (distance / max(len1, len2))
// └── Se < threshold → Cambio drastico sospetto
//
// CHECK C - SUSPICIOUS PATTERNS:
// └── Nuovi pattern: t.me/, bit.ly, crypto, casino
// └── Pattern non presente prima → sospetto

// ----------------------------------------------------------------------------
// 4. TIER 0 EDIT LOCK
// ----------------------------------------------------------------------------
//
// Se edit_lock_tier0 === true:
// └── Utenti con local_flux < 100 NON possono modificare
// └── Azione: elimina modifica + avviso gentile
// └── NON conta come violazione (solo limitazione)

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
// │   │ 🔨 **BAN ESEGUITO (Edit Abuse)**           │
// │   │                                            │
// │   │ 🏛️ Gruppo: Nome Gruppo                    │
// │   │ 👤 Utente: @username (ID: 123456)         │
// │   │ ✏️ Tipo: Link Injection                   │
// │   │                                            │
// │   │ 📄 **PRIMA:** "Ciao, come state?"          │
// │   │ 📄 **DOPO:** "COMPRA CRYPTO: t.me/scam"   │
// │   │ 📊 Similarità: 12%                         │
// │   └────────────────────────────────────────────┘
// │   [ ➕ Blacklist Link ] [ 🌍 Global Ban ]
// └── Auto-delete forward dopo 24h
//
// action === 'report_only':
// ├── NON eliminare, NON bannare
// └── Invia a staff locale con before/after:
//     [ 🔨 Ban ] [ 🗑️ Delete ] [ ✅ Ignora ]

// ----------------------------------------------------------------------------
// 6. CONFIGURATION UI - /editconfig
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ ✏️ **CONFIGURAZIONE ANTI-EDIT ABUSE**      │
// │ Monitoraggio: ✅ | Edit rilevati: 47       │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ ✏️ Monitor: ON ] [ 🔒 Lock Tier 0: ON ]
// [ 📊 Soglia: 50% ◀▶ ]
// [ 🔗 Link Injection: Ban ▼ ] → [ Delete | Ban | Report ]
// [ 👮 Altro Abuso: Delete ▼ ] → [ Delete | Ban | Report ]
// [ 💾 Salva ] [ ❌ Chiudi ]

// ============================================================================
// MODULE EXPORTS
// ============================================================================

let db = null;

const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');



// Clean snapshots periodically (every hour)
setInterval(cleanupSnapshots, 3600000);

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Store snapshot on new message
    bot.on("message:text", async (ctx, next) => {
        if (ctx.chat.type !== 'private') {
            saveSnapshot(ctx.message);
        }
        await next();
    });

    // Handler: edited messages
    bot.on("edited_message", async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip admins
        if (await isUserAdmin(ctx)) return next();

        // Config check
        const config = db.getGuildConfig(ctx.chat.id);
        if (!config.edit_monitor_enabled) return next();

        await processEdit(ctx, config);
        await next();
    });

    // Command: /editconfig
    bot.command("editconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        const member = await ctx.getChatMember(ctx.from.id);
        if (!['creator', 'administrator'].includes(member.status)) return;

        await sendConfigUI(ctx);
    });

    // UI Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("edt_")) return next();

        const config = db.getGuildConfig(ctx.chat.id);
        // Check if we came from settings menu
        let fromSettings = false;
        try {
            const markup = ctx.callbackQuery.message.reply_markup;
            if (markup && markup.inline_keyboard) {
                fromSettings = markup.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'settings_main'));
            }
        } catch (e) { }

        if (data === "edt_close") return ctx.deleteMessage();

        if (data === "edt_toggle") {
            db.updateGuildConfig(ctx.chat.id, { edit_monitor_enabled: config.edit_monitor_enabled ? 0 : 1 });
        } else if (data === "edt_lock") {
            db.updateGuildConfig(ctx.chat.id, { edit_lock_tier0: config.edit_lock_tier0 ? 0 : 1 });
        } else if (data === "edt_thr") {
            let thr = config.edit_similarity_threshold || 0.5;
            thr = thr >= 0.9 ? 0.1 : thr + 0.1;
            db.updateGuildConfig(ctx.chat.id, { edit_similarity_threshold: parseFloat(thr.toFixed(1)) });
        } else if (data === "edt_act_inj") {
            const acts = ['delete', 'ban', 'report_only'];
            let cur = config.edit_link_injection_action || 'ban';
            if (!acts.includes(cur)) cur = 'ban';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 3];
            db.updateGuildConfig(ctx.chat.id, { edit_link_injection_action: nextAct });
        } else if (data === "edt_act_gen") {
            const acts = ['delete', 'ban', 'report_only'];
            let cur = config.edit_abuse_action || 'delete';
            if (!acts.includes(cur)) cur = 'delete';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 3];
            db.updateGuildConfig(ctx.chat.id, { edit_abuse_action: nextAct });
        }

        await sendConfigUI(ctx, true, fromSettings);
    });
}

async function isUserAdmin(ctx) {
    const member = await ctx.getChatMember(ctx.from.id);
    return ['creator', 'administrator'].includes(member.status);
}

function saveSnapshot(message) {
    if (!db) return;
    try {
        const hasLink = /(https?:\/\/[^\s]+)/.test(message.text || '');
        db.getDb().prepare(`
            INSERT INTO message_snapshots (message_id, chat_id, user_id, original_text, original_has_link, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(message.message_id, message.chat.id, message.from.id, message.text, hasLink ? 1 : 0, new Date().toISOString());
    } catch (e) {
        // Ignore unique constraint or other minor errors
    }
}

async function processEdit(ctx, config) {
    const editedMsg = ctx.editedMessage;

    // Tier 0 Lock Check
    if (config.edit_lock_tier0) {
        // We need current tier. Middleware only runs on new messages? 
        // edited_message updates usually don't run regular middleware stack in some setups or are separate.
        // Assuming we need to fetch tier.
        const tier = userReputation.getUserTier(editedMsg.from.id, editedMsg.chat.id);
        if (tier === 0) {
            // Delete and warn
            try {
                await ctx.deleteMessage();
                // Maybe warn?
            } catch (e) { }
            return;
        }
    }

    // Retrieve snapshot
    const snapshot = db.getDb().prepare('SELECT * FROM message_snapshots WHERE message_id = ? AND chat_id = ?').get(editedMsg.message_id, editedMsg.chat.id);

    if (!snapshot) return; // No baseline

    const originalText = snapshot.original_text || "";
    const newText = editedMsg.text || "";
    const originalHasLink = snapshot.original_has_link === 1;
    const newHasLink = /(https?:\/\/[^\s]+)/.test(newText);

    // Check A: Link Injection
    if (!originalHasLink && newHasLink) {
        await executeAction(ctx, config.edit_link_injection_action || 'ban', 'Link Injection', originalText, newText);
        return;
    }

    // Check B: Similarity
    // Skip if very short
    if (originalText.length > 5 && newText.length > 5) {
        const sim = similarity(originalText, newText);
        const threshold = config.edit_similarity_threshold || 0.5;
        if (sim < threshold) {
            await executeAction(ctx, config.edit_abuse_action || 'delete', `Low Similarity (${Math.round(sim * 100)}%)`, originalText, newText);
            return;
        }
    }
}

function similarity(s1, s2) {
    let longer = s1;
    let shorter = s2;
    if (s1.length < s2.length) {
        longer = s2;
        shorter = s1;
    }
    const longerLength = longer.length;
    if (longerLength === 0) {
        return 1.0;
    }
    return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength);
}

function editDistance(s1, s2) {
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();
    const costs = new Array();
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i == 0)
                costs[j] = j;
            else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) != s2.charAt(j - 1))
                        newValue = Math.min(Math.min(newValue, lastValue),
                            costs[j]) + 1;
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0)
            costs[s2.length] = lastValue;
    }
    return costs[s2.length];
}

async function executeAction(ctx, action, reason, original, current) {
    const user = ctx.from; // edited_message.from
    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'edit_abuse',
        targetUser: user,
        executorAdmin: null,
        reason: `${reason}`,
        isGlobal: (action === 'ban')
    };

    if (action === 'delete') {
        try { await ctx.deleteMessage(); } catch (e) { }
    }
    else if (action === 'ban') {
        try {
            await ctx.deleteMessage();
            await ctx.banChatMember(user.id);
            userReputation.modifyFlux(user.id, ctx.chat.id, -100, 'edit_ban');

            if (superAdmin.forwardBanToParliament) {
                superAdmin.forwardBanToParliament({
                    user: user,
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: `Edit Abuse: ${reason}`,
                    evidence: `BEFORE:\n${original}\n\nAFTER:\n${current}`,
                    flux: userReputation.getLocalFlux(user.id, ctx.chat.id)
                });
            }
            logParams.eventType = 'ban';
            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);

        } catch (e) { console.error(e); }
    }
    else if (action === 'report_only') {
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Edit-Abuse',
            user: user,
            reason: `${reason}`,
            messageId: ctx.editedMessage.message_id,
            content: `BEFORE: ${original}\nAFTER: ${current}`
        });
    }
}

function cleanupSnapshots() {
    if (!db) return;
    try {
        // Delete snapshots older than 24h
        // SQLite: datetime('now', '-1 day')
        db.getDb().prepare("DELETE FROM message_snapshots WHERE created_at < datetime('now', '-1 day')").run();
    } catch (e) {
        console.error("Snapshot cleanup failed", e);
    }
}

async function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.edit_monitor_enabled ? '✅ ON' : '❌ OFF';
    const lockT0 = config.edit_lock_tier0 ? '✅ ON' : '❌ OFF';
    const thr = (config.edit_similarity_threshold || 0.5) * 100;
    const actInj = (config.edit_link_injection_action || 'ban').toUpperCase();
    const actGen = (config.edit_abuse_action || 'delete').toUpperCase();

    const text = `✏️ **ANTI-EDIT CONFIG**\n\n` +
        `Monitora modifiche sospette (Link Injection) e cambi completi di senso.\n` +
        `Protegge storico messaggi per 24h.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Link Injection: Critico (Default Ban)\n` +
        `• Similarità < Soglia: Sospetto\n` +
        `• Tier 0 Lock: Novizi non possono editare\n\n` +
        `Stato: ${enabled}\n` +
        `Lock Tier 0: ${lockT0}\n` +
        `Soglia Sim: ${thr}%\n` +
        `Act (Inject): ${actInj}\n` +
        `Act (Abuse): ${actGen}`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "edt_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `✏️ Monitor: ${enabled}`, callback_data: "edt_toggle" }, { text: `🔒 Lock T0: ${lockT0}`, callback_data: "edt_lock" }],
            [{ text: `📊 Soglia: ${thr}%`, callback_data: "edt_thr" }],
            [{ text: `🔗 Inj Act: ${actInj}`, callback_data: "edt_act_inj" }],
            [{ text: `👮 Abuse Act: ${actGen}`, callback_data: "edt_act_gen" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        try { await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' }); } catch (e) { }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = { register, sendConfigUI };
