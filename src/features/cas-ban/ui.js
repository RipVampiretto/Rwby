const { safeEdit } = require('../../utils/error-handlers');
const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);
    const enabled = config.casban_enabled !== 0 ? t('common.on') : t('common.off');
    const notifyEnabled = config.casban_notify !== 0 ? t('common.on') : t('common.off');

    const text =
        `${t('blacklist.title')}\n\n` +
        `${t('blacklist.description')}\n\n` +
        `${t('blacklist.status')}: ${enabled}\n` +
        `${t('blacklist.notify')}: ${notifyEnabled}`;

    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: 'settings_main' }
        : { text: t('common.close'), callback_data: 'cas_close' };

    const keyboard = {
        inline_keyboard: [
            [{ text: `${t('blacklist.buttons.system')}: ${enabled}`, callback_data: 'cas_toggle' }],
            [{ text: `${t('blacklist.buttons.notify')}: ${notifyEnabled}`, callback_data: 'cas_notify' }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'cas-ban');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = {
    sendConfigUI
};
