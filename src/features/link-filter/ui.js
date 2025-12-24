const { safeEdit } = require('../../utils/error-handlers');
const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);
    const enabled = config.link_enabled ? t('common.on') : t('common.off');

    // Parse log events
    let logEvents = {};
    if (config.log_events) {
        if (typeof config.log_events === 'string') {
            try {
                logEvents = JSON.parse(config.log_events);
            } catch (e) {}
        } else if (typeof config.log_events === 'object') {
            logEvents = config.log_events;
        }
    }
    const logDel = logEvents['link_delete'] ? t('common.on') : t('common.off');

    let text = `${t('link.title')}\n\n` + `${t('link.description')}\n\n` + `${t('link.status')}: ${enabled}`;

    // Show details only when enabled
    if (config.link_enabled) {
        text += `\n${t('link.notify')}: ${logDel}`;
    }

    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: 'settings_main' }
        : { text: t('common.close'), callback_data: 'lnk_close' };

    // Build keyboard dynamically
    const rows = [];
    rows.push([{ text: `${t('link.buttons.system')}: ${enabled}`, callback_data: 'lnk_toggle' }]);

    // Show options only when enabled
    if (config.link_enabled) {
        rows.push([{ text: `${t('link.buttons.notify')}: ${logDel}`, callback_data: 'lnk_log_delete' }]);
    }

    rows.push([closeBtn]);

    const keyboard = { inline_keyboard: rows };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'HTML' }, 'link-monitor');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    }
}

module.exports = {
    sendConfigUI
};
