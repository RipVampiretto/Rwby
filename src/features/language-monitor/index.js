// ============================================================================
// TODO: IMPLEMENTATION PLAN - LANGUAGE MONITOR
// ============================================================================
// SCOPO: Rilevamento lingua messaggi e enforcement lingue permesse.
// Usa libreria 'franc' per detection.
// Azioni semplificate: solo DELETE o BAN (con forward a SuperAdmin).
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: guild_config (campi language)
// ├── lang_enabled: INTEGER (0/1, DEFAULT 0)
// ├── allowed_languages: TEXT (JSON Array, es: '["it", "en"]')
// ├── lang_action: TEXT (DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── lang_min_chars: INTEGER (DEFAULT 20)
// ├── lang_confidence_threshold: REAL (DEFAULT 0.8)
// └── lang_tier_bypass: INTEGER (DEFAULT 1)

// ----------------------------------------------------------------------------
// 2. DETECTION LOGIC - Analisi Lingua
// ----------------------------------------------------------------------------
//
// LIBRERIA: franc
// OUTPUT: ISO 639-3 → convertire a ISO 639-1
//
// STEP 1: Pre-filtering (skip < min_chars, skip Tier bypass)
// STEP 2: franc(text) → lingua rilevata
// STEP 3: Se confidence >= threshold e lingua NOT in allowed → VIOLATION

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
// ├── **FORWARD A SUPERADMIN** (per pattern abuso ripetuto)
// └── Auto-delete forward dopo 24h
//
// action === 'report_only':
// └── Invia a staff locale:
//     "Lingua rilevata: RU (94%)"
//     [ 🗑️ Delete ] [ ✅ Ignora ]

// ----------------------------------------------------------------------------
// 4. CONFIGURATION UI - /langconfig
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ 🌐 **CONFIGURAZIONE LINGUA**               │
// │ Lingue permesse: IT, EN                   │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ 🌐 Filtro: OFF ]
// [ 🏳️ Lingue: IT, EN ] → multi-select
// [ 👮 Azione: Delete ▼ ] → [ Delete | Ban | Report ]
// [ 💾 Salva ] [ ❌ Chiudi ]

// ============================================================================
// MODULE EXPORTS
// ============================================================================

let db = null;

const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');



// Load franc dynamically (ESM)
import('franc').then(m => franc = m.franc).catch(e => console.error("Failed to load franc", e));

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Middleware: language detection
    bot.on("message:text", async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip admins
        const member = await ctx.getChatMember(ctx.from.id);
        if (['creator', 'administrator'].includes(member.status)) return next();

        // Config check
        const config = db.getGuildConfig(ctx.chat.id);
        if (!config.lang_enabled) return next();

        // Tier check
        if (ctx.userTier !== undefined && ctx.userTier >= (config.lang_tier_bypass || 1)) return next();

        // Min length check
        if (ctx.message.text.length < (config.lang_min_chars || 20)) return next();

        await processLanguage(ctx, config);
        await next();
    });

    // Command: /langconfig
    bot.command("langconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        const member = await ctx.getChatMember(ctx.from.id);
        if (!['creator', 'administrator'].includes(member.status)) return;

        await sendConfigUI(ctx);
    });

    // UI Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("lng_")) return next();

        const config = db.getGuildConfig(ctx.chat.id);
        if (data === "lng_close") return ctx.deleteMessage();

        if (data === "lng_toggle") {
            db.updateGuildConfig(ctx.chat.id, { lang_enabled: config.lang_enabled ? 0 : 1 });
        } else if (data === "lng_act") {
            const acts = ['delete', 'ban', 'report_only'];
            let cur = config.lang_action || 'delete';
            if (!acts.includes(cur)) cur = 'delete';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 3];
            db.updateGuildConfig(ctx.chat.id, { lang_action: nextAct });
        } else if (data.startsWith("lng_set:")) {
            const lang = data.split(':')[1];
            let allowed = [];
            try { allowed = JSON.parse(config.allowed_languages || '[]'); } catch (e) { }

            if (allowed.includes(lang)) {
                allowed = allowed.filter(l => l !== lang);
            } else {
                allowed.push(lang);
            }
            db.updateGuildConfig(ctx.chat.id, { allowed_languages: JSON.stringify(allowed) });
        }

        await sendConfigUI(ctx, true);
    });
}

function getIso1(iso3) {
    // Simple mapping for common checks. franc returns ISO-639-3
    const map = {
        'ita': 'it', 'eng': 'en', 'rus': 'ru', 'spa': 'es', 'fra': 'fr', 'deu': 'de',
        'por': 'pt', 'zho': 'zh', 'jpn': 'ja', 'ara': 'ar', 'hin': 'hi'
    };
    return map[iso3] || iso3;
}

async function processLanguage(ctx, config) {
    if (!franc) return; // Library not ready

    const text = ctx.message.text;
    const detectedIso3 = franc(text);

    if (detectedIso3 === 'und') return; // Undetermined

    const detected = getIso1(detectedIso3);
    let allowed = ['it', 'en']; // Default
    try {
        const parsed = JSON.parse(config.allowed_languages || '[]');
        if (parsed.length > 0) allowed = parsed;
    } catch (e) { }

    // Check strict enforcement?
    // Usually if detected is strictly NOT in allowed.
    // However, franc is not 100% accurate on short texts. config.lang_min_chars helps.

    if (!allowed.includes(detected)) {
        // Violation
        await executeAction(ctx, config.lang_action || 'delete', detected, allowed);
    }
}

async function executeAction(ctx, action, detected, allowed) {
    const user = ctx.from;
    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'lang_violation',
        targetUser: user,
        executorAdmin: null,
        reason: `Language: ${detected} (Allowed: ${allowed.join(', ')})`,
        isGlobal: (action === 'ban')
    };

    if (action === 'delete') {
        try { await ctx.deleteMessage(); } catch (e) { }
        // Log?
    }
    else if (action === 'ban') {
        try {
            await ctx.deleteMessage();
            await ctx.banChatMember(user.id);
            userReputation.modifyFlux(user.id, ctx.chat.id, -20, 'lang_ban');

            if (superAdmin.forwardBanToParliament) {
                superAdmin.forwardBanToParliament({
                    user: user,
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: `Language Ban: ${detected} not allowed.`,
                    evidence: ctx.message.text,
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
            source: 'Language',
            user: user,
            reason: `Detected: ${detected}\nAllowed: ${allowed.join(', ')}`,
            messageId: ctx.message.message_id,
            content: ctx.message.text
        });
    }
}

async function sendConfigUI(ctx, isEdit = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.lang_enabled ? '✅ ON' : '❌ OFF';
    const action = (config.lang_action || 'delete').toUpperCase();

    let allowed = [];
    try { allowed = JSON.parse(config.allowed_languages || '[]'); } catch (e) { }
    if (allowed.length === 0) allowed = ['it', 'en']; // Visual default

    const text = `🌐 **CONFIGURAZIONE LINGUA**\n` +
        `Stato: ${enabled}\n` +
        `Azione: ${action}\n` +
        `Permesse: ${allowed.join(', ').toUpperCase()}`;

    // Language toggles (Common ones)
    const common = ['it', 'en', 'ru', 'es', 'fr', 'de'];
    const langRow = common.map(l => {
        const isAllowed = allowed.includes(l);
        return { text: `${isAllowed ? '✅' : '⬜'} ${l.toUpperCase()}`, callback_data: `lng_set:${l}` };
    });

    const keyboard = {
        inline_keyboard: [
            [{ text: `🌐 Filtro: ${enabled}`, callback_data: "lng_toggle" }],
            langRow,
            [{ text: `👮 Azione: ${action}`, callback_data: "lng_act" }],
            [{ text: "❌ Chiudi", callback_data: "lng_close" }]
        ]
    };

    if (isEdit) {
        try { await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' }); } catch (e) { }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = { register };
