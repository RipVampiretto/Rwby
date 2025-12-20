const { safeEdit } = require('../../utils/error-handlers');
const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const t = (key, params) => i18n.t(guildId, key, params);

    const config = db.getGuildConfig(guildId);
    const enabled = config.link_enabled ? t('common.on') : t('common.off');
    const sync = config.link_sync_global ? t('common.on') : t('common.off');
    const tierBypass = config.link_tier_bypass ?? 2;

    const text = `${t('link.title')}\n\n` +
        `${t('link.description')}\n\n` +
        `ℹ️ **${t('link.info_title')}:**\n` +
        `• ${t('link.info_1')}\n` +
        `• ${t('link.info_2')}\n\n` +
        `${t('link.status')}: ${enabled}\n` +
        `${t('link.tier_bypass')}: ${tierBypass === -1 ? 'OFF' : tierBypass + '+'}\n` +
        `${t('link.global_sync')}: ${sync}`;

    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: "settings_main" }
        : { text: t('common.close'), callback_data: "lnk_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `${t('link.buttons.monitor')}: ${enabled}`, callback_data: "lnk_toggle" }],
            [{ text: `${t('link.buttons.tier')}: ${tierBypass}+`, callback_data: "lnk_tier" }],
            [{ text: `${t('link.buttons.sync')}: ${sync}`, callback_data: "lnk_sync" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'link-monitor');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = {
    sendConfigUI
};
