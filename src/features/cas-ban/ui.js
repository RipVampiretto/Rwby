const { safeEdit } = require('../../utils/error-handlers');
const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);
    const enabled = config.casban_enabled !== 0 ? t('common.on') : t('common.off');

    const text =
        `${t('blacklist.title')}\n\n` +
        `${t('blacklist.description')}\n\n` +
        `ℹ️ **${t('blacklist.info_title')}:**\n` +
        `• ${t('blacklist.info_1')}\n` +
        `• ${t('blacklist.info_2')}\n` +
        `• ${t('blacklist.info_3')}\n` +
        `• ${t('blacklist.info_4')}\n\n` +
        `${t('common.status')}: ${enabled}`;

    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: 'settings_main' }
        : { text: t('common.close'), callback_data: 'cas_close' };

    const keyboard = {
        inline_keyboard: [
            [{ text: `${t('blacklist.buttons.system')}: ${enabled}`, callback_data: 'cas_toggle' }],
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
