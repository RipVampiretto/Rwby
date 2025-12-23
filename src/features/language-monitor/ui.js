const { safeEdit } = require('../../utils/error-handlers');
const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);
    const enabled = config.lang_enabled ? t('common.on') : t('common.off');
    const action = i18n.formatAction(guildId, config.lang_action || 'delete');
    const tierBypass = config.lang_tier_bypass ?? 2;
    const tierDisplay = tierBypass === -1 ? 'OFF' : `${tierBypass}+`;

    let allowed = [];
    if (config.allowed_languages) {
        // Handle both string (legacy) and array (PostgreSQL JSONB) formats
        if (Array.isArray(config.allowed_languages)) {
            allowed = config.allowed_languages;
        } else if (typeof config.allowed_languages === 'string') {
            try {
                allowed = JSON.parse(config.allowed_languages);
            } catch (e) { }
        }
    }
    if (allowed.length === 0) allowed = ['it', 'en'];

    const text =
        `${t('language.title')}\n\n` +
        `${t('language.description')}\n\n` +
        `ℹ️ **${t('language.info_title')}:**\n` +
        `• ${t('language.info_1')}\n` +
        `• ${t('language.info_2')}\n\n` +
        `${t('language.status')}: ${enabled}\n` +
        `${t('language.tier_bypass')}: ${tierDisplay}\n` +
        `${t('language.action')}: ${action}\n` +
        `${t('language.allowed')}: ${allowed.join(', ').toUpperCase()}`;

    // Language toggles
    const common = ['it', 'en', 'ru', 'es', 'fr', 'de'];
    const langButtons = common.map(l => {
        const isAllowed = allowed.includes(l);
        return { text: `${isAllowed ? '✅' : '⬜'} ${l.toUpperCase()}`, callback_data: `lng_set:${l}` };
    });
    const langRows = [];
    for (let i = 0; i < langButtons.length; i += 3) {
        langRows.push(langButtons.slice(i, i + 3));
    }

    // Parse log events
    let logEvents = {};
    if (config.log_events) {
        if (typeof config.log_events === 'string') {
            try { logEvents = JSON.parse(config.log_events); } catch (e) { }
        } else if (typeof config.log_events === 'object') {
            logEvents = config.log_events;
        }
    }
    const logDel = logEvents['lang_delete'] ? '✅' : '❌';
    const logBan = logEvents['lang_ban'] ? '✅' : '❌';

    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: 'settings_main' }
        : { text: t('common.close'), callback_data: 'lng_close' };

    const keyboard = {
        inline_keyboard: [
            [{ text: `${t('language.buttons.filter')}: ${enabled}`, callback_data: 'lng_toggle' }],
            [{ text: `${t('language.buttons.tier')}: ${tierDisplay}`, callback_data: 'lng_tier' }],
            ...langRows,
            [{ text: `${t('language.buttons.action')}: ${action}`, callback_data: 'lng_act' }],
            // Log toggles
            [
                { text: `📋 Log 🗑️${logDel}`, callback_data: 'lng_log_delete' },
                { text: `📋 Log 🚷${logBan}`, callback_data: 'lng_log_ban' }
            ],
            [closeBtn]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'language-monitor');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = {
    sendConfigUI
};
