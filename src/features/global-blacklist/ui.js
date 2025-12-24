const { safeEdit } = require('../../utils/error-handlers');
const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);
    const enabled = config.blacklist_enabled ? t('common.on') : t('common.off');
    const notifyEnabled = config.blacklist_notify ? t('common.on') : t('common.off');

    let text =
        `${t('blacklist.title')}\n\n` + `${t('blacklist.description')}\n\n` + `${t('blacklist.status')}: ${enabled}`;

    // Show details only when enabled
    if (config.blacklist_enabled) {
        text += `\n${t('blacklist.notify')}: ${notifyEnabled}`;
    }

    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: 'settings_main' }
        : { text: t('common.close'), callback_data: 'cas_close' };

    // Build keyboard dynamically
    const rows = [];
    rows.push([{ text: `${t('blacklist.buttons.system')}: ${enabled}`, callback_data: 'cas_toggle' }]);

    // Show notify button only when enabled
    if (config.blacklist_enabled) {
        rows.push([{ text: `${t('blacklist.buttons.notify')}: ${notifyEnabled}`, callback_data: 'cas_notify' }]);
    }

    rows.push([closeBtn]);

    const keyboard = { inline_keyboard: rows };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'HTML' }, 'cas-ban');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    }
}

module.exports = {
    sendConfigUI
};
