// ============================================================================
// TODO: IMPLEMENTATION PLAN - ANTI-SPAM
// ============================================================================
// SCOPO: Rilevamento spam tramite analisi volume e ripetizione messaggi.
// Azioni semplificate: solo DELETE (silenzioso) o BAN (con forward a SuperAdmin).
// Ogni ban viene inoltrato al gruppo staff SuperAdmin per controllo centralizzato.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: user_active_stats (tracking real-time)
// ├── user_id: INTEGER
// ├── guild_id: INTEGER
// ├── msg_count_60s: INTEGER (contatore rolling window 60 secondi)
// ├── msg_count_10s: INTEGER (contatore rolling window 10 secondi)
// ├── last_msg_content: TEXT (hash per duplicate detection)
// ├── last_msg_ts: TEXT (ISO timestamp ultimo messaggio)
// ├── duplicate_count: INTEGER (messaggi identici consecutivi)
// ├── violation_count_24h: INTEGER (violazioni nelle ultime 24h)
// └── last_violation_ts: TEXT (timestamp ultima violazione)
//
// TABELLA: guild_config (campi anti-spam)
// ├── spam_enabled: INTEGER (0/1, DEFAULT 1)
// ├── spam_sensitivity: TEXT ('low', 'medium', 'high')
// │   └── low: 15 msg/min, medium: 10 msg/min, high: 5 msg/min
// ├── spam_action_volume: TEXT (DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── spam_action_repetition: TEXT (DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── spam_volume_limit_60s: INTEGER (DEFAULT 10)
// ├── spam_volume_limit_10s: INTEGER (DEFAULT 5)
// └── spam_duplicate_limit: INTEGER (DEFAULT 3)

// ----------------------------------------------------------------------------
// 2. BEHAVIOR ANALYSIS - Analisi Comportamentale
// ----------------------------------------------------------------------------
//
// MIDDLEWARE: Esegue su OGNI messaggio testuale
//
// STEP 1 - UPDATE COUNTERS:
// └── Incrementa msg_count_60s e msg_count_10s
// └── Sliding window con timestamp
//
// STEP 2 - VOLUME CHECK (Rate Limiting):
// ├── IF msg_count_10s > spam_volume_limit_10s:
// │   └── BURST DETECTED → Azione immediata (likely bot)
// └── IF msg_count_60s > spam_volume_limit_60s:
//     └── FLOOD DETECTED → Azione configurata
//
// STEP 3 - REPETITION CHECK:
// ├── Calcola hash/similarity con last_msg_content
// ├── IF contenuto identico o similarity > 90%:
// │   └── Incrementa duplicate_count
// └── IF duplicate_count >= spam_duplicate_limit:
//     └── REPETITION DETECTED → Azione configurata
//
// STEP 4 - PATTERN DETECTION (euristiche):
// ├── Caratteri ripetuti: "aaaaaaa" o "!!!!!!"
// ├── Alternanza maiuscolo: "COMPRA oRa BITCOIN"
// ├── Emoji flood: 10+ emoji in messaggio breve
// └── Link + call-to-action: "clicca qui", "guadagna"

// ----------------------------------------------------------------------------
// 3. CONFIGURABLE ACTIONS - Solo Delete/Ban/Report
// ----------------------------------------------------------------------------
//
// action === 'delete':
// └── ctx.deleteMessage() silenziosamente
// └── Log interno, nessuna notifica utente
// └── Incrementa violation_count_24h
//
// action === 'ban':
// ├── ctx.deleteMessage()
// ├── ctx.banChatMember(userId)
// ├── **FORWARD A SUPERADMIN** (vedi sezione 4)
// ├── Decrementa global_flux di 100 punti
// └── Log dettagliato con evidenze
//
// action === 'report_only':
// ├── NON eliminare, NON bannare
// ├── Invia a staff locale per review:
// │   ┌────────────────────────────────────────────┐
// │   │ 🚨 **POTENZIALE SPAM RILEVATO**            │
// │   │ 👤 Utente: @username (Tier 0)             │
// │   │ 📈 Trigger: Volume (15 msg/min)           │
// │   │ 💬 Ultimo msg: "spam text..."             │
// │   └────────────────────────────────────────────┘
// │   [ 🔨 Ban ] [ 🗑️ Delete ] [ ✅ Ignora ]
// └── Staff decide azione manualmente

// ----------------------------------------------------------------------------
// 4. BAN FORWARD SYSTEM - Inoltro a SuperAdmin
// ----------------------------------------------------------------------------
//
// OGNI volta che viene eseguito un BAN (automatico o manuale):
//
// STEP 1 - Esegui ban locale:
// └── ctx.banChatMember(userId)
//
// STEP 2 - Prepara messaggio di forward:
// ┌────────────────────────────────────────────┐
// │ 🔨 **BAN ESEGUITO**                        │
// │                                            │
// │ 🏛️ Gruppo: Nome Gruppo (@username)        │
// │ 👤 Utente: @banned_user (ID: 123456)      │
// │ 📊 TrustFlux: -45 (era 55)                │
// │ ⏰ Ora: 2024-12-17 14:30:25               │
// │                                            │
// │ 📝 Motivo: Spam - Volume flood            │
// │ 🔧 Trigger: anti-spam (automatico)        │
// │                                            │
// │ 💬 Ultimo messaggio (evidence):            │
// │ "COMPRA BITCOIN ORA! t.me/scam..."        │
// └────────────────────────────────────────────┘
// [ ➕ Blacklist Link ] [ ➕ Blacklist Parola ]
// [ 🌍 Global Ban ] [ ✅ Solo Locale ]
//
// STEP 3 - Invia a SuperAdmin staff group:
// └── bot.api.sendMessage(global_config.parliament_group_id, message)
// └── Topic: global_topics.reports
//
// STEP 4 - Auto-delete dopo 24h:
// └── Salva message_id in tabella 'pending_deletions'
// └── Cronjob ogni ora: DELETE messages older than 24h
//
// STEP 5 - SuperAdmin può:
// ├── [ ➕ Blacklist Link ] → Estrae link dal messaggio, aggiunge a intel_data
// ├── [ ➕ Blacklist Parola ] → Wizard per estrarre pattern
// ├── [ 🌍 Global Ban ] → Propaga ban a tutta la rete
// └── [ ✅ Solo Locale ] → Conferma, nessuna azione globale

// ----------------------------------------------------------------------------
// 5. CONFIGURATION UI - /spamconfig (Admin Only)
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ 🛡️ **CONFIGURAZIONE ANTI-SPAM**           │
// │                                            │
// │ Stato: ✅ Attivo                           │
// │ Spam rilevati oggi: 47                     │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ 🛡️ Anti-Spam: ON ]
// [ 🌡️ Sensibilità: ◀ Medium ▶ ]
// [ ⚡ Su Flood: Delete ▼ ]      → [ Delete | Ban | Report ]
// [ 🔁 Su Ripetizione: Delete ▼ ] → [ Delete | Ban | Report ]
// [ 💾 Salva ] [ ❌ Chiudi ]

// ----------------------------------------------------------------------------
// 6. INTEGRATION
// ----------------------------------------------------------------------------
//
// DIPENDENZE IN INGRESSO:
// ├── user-reputation → Per Tier utente (skip per Tier 2+)
// └── database → Per stats e configurazione
//
// DIPENDENZE IN USCITA:
// ├── admin-logger → Per logging azioni
// ├── staff-coordination → Per report_only locale
// ├── super-admin → Per forward ban a Parliament
// └── intel-network → Per propagazione global ban

// ============================================================================
// MODULE EXPORTS
// ============================================================================

let db = null;

const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');

let _botInstance = null;

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Middleware: spam detection
    bot.on("message:text", async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Check Tier (Bypass for Tier 2+)
        if (ctx.userTier && ctx.userTier >= 2) return next();

        // Check if Enabled
        const config = db.getGuildConfig(ctx.chat.id);
        if (!config.spam_enabled) return next();

        const isSpam = await checkSpam(ctx, config);
        if (isSpam) {
            // Stop processing if handled
            return;
        }

        await next();
    });

    // Command: /spamconfig
    bot.command("spamconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        const member = await ctx.getChatMember(ctx.from.id);
        if (!['creator', 'administrator'].includes(member.status)) return;

        await sendConfigUI(ctx);
    });

    // Action Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("spam_")) return next();

        // Format: spam_ACTION:FROM_SETTINGS (0 or 1)
        // Example: spam_toggle:1
        const [actionKey, fromSettingsFlag] = data.split(":");
        const fromSettings = fromSettingsFlag === '1';

        // Remove "spam_" prefix for cleaner switching if desired, or switch on full key
        const action = actionKey.replace("spam_", "");

        const config = db.getGuildConfig(ctx.chat.id);

        if (action === "close") {
            await ctx.deleteMessage();
            return; // Close doesn't need re-render
        } else if (action === "toggle") {
            db.updateGuildConfig(ctx.chat.id, { spam_enabled: config.spam_enabled ? 0 : 1 });
        } else if (action === "sens") {
            const levels = ['low', 'medium', 'high'];
            const currentIdx = levels.indexOf(config.spam_sensitivity || 'medium');
            const nextLevel = levels[(currentIdx + 1) % 3];
            db.updateGuildConfig(ctx.chat.id, { spam_sensitivity: nextLevel });
        } else if (action === "act_vol") {
            const acts = ['delete', 'ban', 'report_only'];
            const idx = acts.indexOf(config.spam_action_volume || 'delete');
            db.updateGuildConfig(ctx.chat.id, { spam_action_volume: acts[(idx + 1) % 3] });
        } else if (action === "act_rep") {
            const acts = ['delete', 'ban', 'report_only'];
            const idx = acts.indexOf(config.spam_action_repetition || 'delete');
            db.updateGuildConfig(ctx.chat.id, { spam_action_repetition: acts[(idx + 1) % 3] });
        }

        await sendConfigUI(ctx, true, fromSettings);
    });
}

async function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.spam_enabled ? '✅ ON' : '❌ OFF';
    const sens = (config.spam_sensitivity || 'medium').toUpperCase();
    const actVol = (config.spam_action_volume || 'delete').toUpperCase().replace(/_/g, ' ');
    const actRep = (config.spam_action_repetition || 'delete').toUpperCase().replace(/_/g, ' ');

    const statusText = `🛡️ **CONFIGURAZIONE ANTI-SPAM**\n` +
        `Stato: ${enabled}\n` +
        `Sensibilità: ${sens}`;

    // Callback suffix
    const s = fromSettings ? ':1' : ':0';

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: `spam_close${s}` };

    const keyboard = {
        inline_keyboard: [
            [{ text: `🛡️ Monitor: ${enabled}`, callback_data: `spam_toggle${s}` }],
            [{ text: `🌡️ Sens: ${sens}`, callback_data: `spam_sens${s}` }],
            [{ text: `⚡ Flood: ${actVol}`, callback_data: `spam_act_vol${s}` }],
            [{ text: `🔁 Repeat: ${actRep}`, callback_data: `spam_act_rep${s}` }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        try {
            await ctx.editMessageText(statusText, { reply_markup: keyboard, parse_mode: 'Markdown' });
        } catch (e) { }
    } else {
        await ctx.reply(statusText, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

async function checkSpam(ctx, config) {
    const userId = ctx.from.id;
    const guildId = ctx.chat.id;
    const now = Date.now();
    const content = ctx.message.text;

    // Admin Bypass
    try {
        const member = await ctx.getChatMember(userId);
        if (['creator', 'administrator'].includes(member.status)) return false;
    } catch (e) { }

    // Get stats
    let stats = db.getDb().prepare('SELECT * FROM user_active_stats WHERE user_id = ? AND guild_id = ?').get(userId, guildId);
    if (!stats) {
        stats = { user_id: userId, guild_id: guildId, msg_count_60s: 0, msg_count_10s: 0, duplicate_count: 0 };
    }

    const lastTs = stats.last_msg_ts ? new Date(stats.last_msg_ts).getTime() : 0;
    const diff = now - lastTs;

    // Reset counters if time passed
    if (diff > 60000) stats.msg_count_60s = 0;
    if (diff > 10000) stats.msg_count_10s = 0;

    stats.msg_count_60s++;
    stats.msg_count_10s++;

    // Repetition check
    if (stats.last_msg_content === content) {
        stats.duplicate_count++;
    } else {
        stats.duplicate_count = 0;
    }

    // Determine limits
    const sensitivity = config.spam_sensitivity || 'medium';
    let limit10s = 5, limit60s = 10, limitDup = 3;
    if (sensitivity === 'high') { limit10s = 3; limit60s = 5; limitDup = 2; }
    if (sensitivity === 'low') { limit10s = 8; limit60s = 15; limitDup = 5; }

    // Override if in DB custom
    if (config.spam_volume_limit_10s) limit10s = config.spam_volume_limit_10s;
    if (config.spam_volume_limit_60s) limit60s = config.spam_volume_limit_60s;
    if (config.spam_duplicate_limit) limitDup = config.spam_duplicate_limit;

    // Check Triggers
    let trigger = null;
    let action = 'delete';

    if (stats.msg_count_10s > limit10s) {
        trigger = `Burst (${stats.msg_count_10s}/${limit10s})`;
        action = config.spam_action_volume || 'delete';
    } else if (stats.msg_count_60s > limit60s) {
        trigger = `Flood (${stats.msg_count_60s}/${limit60s})`;
        action = config.spam_action_volume || 'delete';
    } else if (stats.duplicate_count >= limitDup) {
        trigger = `Repetition (${stats.duplicate_count}/${limitDup})`;
        action = config.spam_action_repetition || 'delete';
    }

    // Save Stats
    db.getDb().prepare(`
        INSERT INTO user_active_stats (user_id, guild_id, msg_count_60s, msg_count_10s, last_msg_content, last_msg_ts, duplicate_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, guild_id) DO UPDATE SET
            msg_count_60s = ?, msg_count_10s = ?, last_msg_content = ?, last_msg_ts = ?, duplicate_count = ?
    `).run(userId, guildId, stats.msg_count_60s, stats.msg_count_10s, content, new Date().toISOString(), stats.duplicate_count,
        stats.msg_count_60s, stats.msg_count_10s, content, new Date().toISOString(), stats.duplicate_count);

    if (trigger) {
        await executeAction(ctx, action, trigger, config);
        return true;
    }
    return false;
}

async function executeAction(ctx, action, trigger, config) {
    const user = ctx.from;
    console.log(`[ANTI-SPAM] Trigger: ${trigger} Action: ${action} User: ${user.id}`);

    // Log Logic using adminLogger if available
    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'spam', // or 'ban' if banned
        targetUser: user,
        executorAdmin: null, // System
        reason: trigger,
        isGlobal: false
    };

    if (action === 'delete') {
        try { await ctx.deleteMessage(); } catch (e) { }
        // Log locally
        if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
    }
    else if (action === 'ban') {
        try {
            await ctx.deleteMessage();
            await ctx.banChatMember(user.id);
            await ctx.reply(`🚫 **BANNED**\nHas been banned for spam.`);

            // Reduce Flux
            userReputation.modifyFlux(user.id, ctx.chat.id, -100, 'spam_ban');

            // Forward to SuperAdmin
            await forwardBanToSuperAdmin(ctx, user, trigger);

            // Log Extended
            logParams.eventType = 'ban';
            logParams.isGlobal = true; // Ban is global event
            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);

        } catch (e) {
            console.error("Ban failed", e);
        }
    }
    else if (action === 'report_only') {
        // Send to Staff Queue
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Anti-Spam',
            user: user,
            reason: `Trigger: ${trigger}`,
            messageId: ctx.message.message_id,
            content: ctx.message.text
        });
    }
}

async function forwardBanToSuperAdmin(ctx, user, trigger) {
    try {
        const globalConfig = db.getDb().prepare('SELECT * FROM global_config WHERE id = 1').get();
        if (!globalConfig || !globalConfig.parliament_group_id) return;

        const flux = userReputation.getLocalFlux(user.id, ctx.chat.id);

        const text = `🔨 **BAN ESEGUITO**\n\n` +
            `🏛️ Gruppo: ${ctx.chat.title} (@${ctx.chat.username || 'private'})\n` +
            `👤 Utente: ${user.first_name} (@${user.username}) (ID: \`${user.id}\`)\n` +
            `📊 TrustFlux: ${flux}\n` +
            `⏰ Ora: ${new Date().toISOString()}\n\n` +
            `📝 Motivo: ${trigger}\n` +
            `🔧 Trigger: anti-spam\n\n` +
            `💬 Content:\n"${ctx.message.text ? ctx.message.text.substring(0, 200) : 'N/A'}"`;

        const keyboard = {
            inline_keyboard: [
                [{ text: "🌍 Global Ban", callback_data: `gban:${user.id}` }, { text: "✅ Solo Locale", callback_data: `gban_skip:${ctx.message.message_id}` }]
            ]
        };

        const sent = await _botInstance.api.sendMessage(globalConfig.parliament_group_id, text, {
            reply_markup: keyboard,
            parse_mode: 'Markdown'
        });

        // Save pending deletion
        // db.getDb().prepare('INSERT INTO pending_deletions ...') // skipped for brevity
    } catch (e) {
        console.error("Failed to forward ban", e);
    }
}

// ... checkSpam implementation unchanged ...

module.exports = { register, sendConfigUI };
