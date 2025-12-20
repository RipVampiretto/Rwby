// ============================================================================
// LANGUAGE MONITOR MODULE
// ============================================================================
// SCOPO: Rilevamento lingua messaggi e enforcement lingue permesse.
// Usa libreria 'franc' per detection.
// Azioni semplificate: DELETE, BAN, o REPORT_ONLY.
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
// └── lang_tier_bypass: INTEGER (DEFAULT 2)

// ============================================================================
// MODULE EXPORTS
// ============================================================================

let db = null;

const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');
const { safeDelete, safeEdit, safeBan, isAdmin, handleCriticalError, isFromSettingsMenu } = require('../../utils/error-handlers');
const loggerUtil = require('../../middlewares/logger');
const i18n = require('../../i18n');

let _botInstance = null;
let franc = null;
let francReady = false;

// Load franc dynamically (ESM) - block until ready
const francPromise = import('franc').then(m => {
    franc = m.franc;
    francReady = true;
    loggerUtil.info('[language-monitor] Franc library loaded successfully');
}).catch(e => {
    loggerUtil.error(`[language-monitor] Failed to load franc: ${e.message}`);
});

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Middleware: language detection
    bot.on("message:text", async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Wait for franc to be ready (only blocks first few messages)
        if (!francReady) {
            await francPromise;
            if (!francReady) return next(); // Franc failed to load, skip
        }

        // Skip admins
        if (await isAdmin(ctx, 'language-monitor')) return next();

        // Config check
        const config = db.getGuildConfig(ctx.chat.id);
        if (!config.lang_enabled) return next();

        // Tier bypass check
        const tierBypass = config.lang_tier_bypass ?? 2;
        if (ctx.userTier !== undefined && ctx.userTier >= tierBypass) return next();

        // Min length check
        if (ctx.message.text.length < (config.lang_min_chars || 20)) return next();

        await processLanguage(ctx, config);
        await next();
    });

    // Command: /langconfig
    bot.command("langconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        if (!await isAdmin(ctx, 'language-monitor')) return;

        await sendConfigUI(ctx);
    });

    // UI Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("lng_")) return next();

        const config = db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === "lng_close") return ctx.deleteMessage();

        if (data === "lng_toggle") {
            db.updateGuildConfig(ctx.chat.id, { lang_enabled: config.lang_enabled ? 0 : 1 });
        } else if (data === "lng_act") {
            const acts = ['delete', 'ban', 'report_only'];
            let cur = config.lang_action || 'delete';
            if (!acts.includes(cur)) cur = 'delete';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 3];
            db.updateGuildConfig(ctx.chat.id, { lang_action: nextAct });
        } else if (data === "lng_tier") {
            // Cycle through 0, 1, 2, 3
            const current = config.lang_tier_bypass ?? 2;
            const next = (current + 1) % 4;
            db.updateGuildConfig(ctx.chat.id, { lang_tier_bypass: next });
        } else if (data.startsWith("lng_set:")) {
            const lang = data.split(':')[1];
            let allowed = [];
            try { allowed = JSON.parse(config.allowed_languages || '[]'); } catch (e) { }
            if (allowed.length === 0) allowed = ['it', 'en'];

            if (allowed.includes(lang)) {
                // Remove if > 1
                if (allowed.length > 1)
                    allowed = allowed.filter(l => l !== lang);
            } else {
                allowed.push(lang);
            }
            db.updateGuildConfig(ctx.chat.id, { allowed_languages: JSON.stringify(allowed) });
        }

        await sendConfigUI(ctx, true, fromSettings);
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

/**
 * Check if text contains non-Latin scripts (Chinese, Arabic, Cyrillic, etc.)
 * This catches foreign text even in very short messages
 */
function detectNonLatinScript(text) {
    // Chinese/Japanese/Korean
    if (/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text)) return 'zh';
    // Arabic
    if (/[\u0600-\u06ff]/.test(text)) return 'ar';
    // Cyrillic (Russian, etc.)
    if (/[\u0400-\u04ff]/.test(text)) return 'ru';
    // Hebrew
    if (/[\u0590-\u05ff]/.test(text)) return 'he';
    // Thai
    if (/[\u0e00-\u0e7f]/.test(text)) return 'th';
    // Hindi/Devanagari
    if (/[\u0900-\u097f]/.test(text)) return 'hi';

    return null; // Latin or unknown
}

async function processLanguage(ctx, config) {
    const text = ctx.message.text;

    let allowed = ['it', 'en']; // Default
    try {
        const parsed = JSON.parse(config.allowed_languages || '[]');
        if (parsed.length > 0) allowed = parsed;
    } catch (e) { }

    // First check: Non-Latin script detection (works on any length)
    const scriptLang = detectNonLatinScript(text);
    if (scriptLang && !allowed.includes(scriptLang)) {
        await executeAction(ctx, config, scriptLang, allowed);
        return;
    }

    // Second check: franc for longer texts (needs min_chars)
    if (!franc || text.length < (config.lang_min_chars || 20)) return;

    const detectedIso3 = franc(text);
    if (detectedIso3 === 'und') return; // Undetermined

    const detected = getIso1(detectedIso3);
    if (!allowed.includes(detected)) {
        await executeAction(ctx, config, detected, allowed);
    }
}

async function executeAction(ctx, config, detected, allowed) {
    const action = config.lang_action || 'delete';
    const user = ctx.from;
    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'lang_violation',
        targetUser: user,
        executorAdmin: null,
        reason: `Language: ${detected} (Allowed: ${allowed.join(', ')})`,
        isGlobal: (action === 'ban')
    };

    // Get translation for this guild's UI language
    const userName = user.username ? `@${user.username}` : `[${user.first_name}](tg://user?id=${user.id})`;
    const warningMsg = i18n.t(ctx.chat.id, 'language_monitor.warning', {
        languages: allowed.join(', ').toUpperCase(),
        user: userName
    });

    if (action === 'delete') {
        await safeDelete(ctx, 'language-monitor');
        // Send warning and auto-delete after 1 minute
        try {
            const warning = await ctx.reply(warningMsg);
            setTimeout(async () => {
                try { await ctx.api.deleteMessage(ctx.chat.id, warning.message_id); } catch (e) { }
            }, 60000); // 1 minute
        } catch (e) { }
    }
    else if (action === 'ban') {
        await safeDelete(ctx, 'language-monitor');
        const banned = await safeBan(ctx, user.id, 'language-monitor');

        if (banned) {
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
        }
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

async function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.lang_enabled ? '✅ ON' : '❌ OFF';
    const action = (config.lang_action || 'delete').toUpperCase().replace(/_/g, ' ');
    const tierBypass = config.lang_tier_bypass ?? 2;

    let allowed = [];
    try { allowed = JSON.parse(config.allowed_languages || '[]'); } catch (e) { }
    if (allowed.length === 0) allowed = ['it', 'en']; // Visual default

    const text = `🌐 **FILTRO LINGUA**\n\n` +
        `Rileva e blocca messaggi scritti in lingue non permesse.\n` +
        `Utile per mantenere il gruppo focalizzato.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Ignora messaggi molto brevi\n` +
        `• Invia avviso auto-eliminante all'utente\n\n` +
        `Stato: ${enabled}\n` +
        `Bypass da Tier: ${tierBypass}+\n` +
        `Azione: ${action}\n` +
        `Permesse: ${allowed.join(', ').toUpperCase()}`;

    // Language toggles (Common ones) - max 3 per row
    const common = ['it', 'en', 'ru', 'es', 'fr', 'de'];
    const langButtons = common.map(l => {
        const isAllowed = allowed.includes(l);
        return { text: `${isAllowed ? '✅' : '⬜'} ${l.toUpperCase()}`, callback_data: `lng_set:${l}` };
    });
    // Split into rows of 3
    const langRows = [];
    for (let i = 0; i < langButtons.length; i += 3) {
        langRows.push(langButtons.slice(i, i + 3));
    }

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "lng_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `🌐 Filtro: ${enabled}`, callback_data: "lng_toggle" }],
            [{ text: `👤 Bypass Tier: ${tierBypass}+`, callback_data: "lng_tier" }],
            ...langRows,
            [{ text: `👮 Azione: ${action}`, callback_data: "lng_act" }],
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
