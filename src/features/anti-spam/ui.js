const { safeEdit } = require('../../utils/error-handlers');
const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);
    const enabled = config.spam_enabled ? t('common.on') : t('common.off');
    const sens = config.spam_sensitivity || 'medium';
    const sensLabel = t(`antispam.sensitivity_values.${sens}`);
    const actVol = i18n.formatAction(guildId, config.spam_action_volume || 'delete');
    const actRep = i18n.formatAction(guildId, config.spam_action_repetition || 'delete');

    const statusText =
        `${t('antispam.title')}\n\n` +
        `${t('antispam.description')}\n\n` +
        `${t('antispam.info_title')}\n` +
        `${t('antispam.info_items.sensitivity')}\n` +
        `${t('antispam.info_items.detects')}\n` +
        `${t('antispam.info_items.trusted')}\n\n` +
        `${t('antispam.status')}: ${enabled}\n` +
        `${t('antispam.sensitivity')}: ${sensLabel}`;

    // Callback suffix
    const s = fromSettings ? ':1' : ':0';

    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: 'settings_main' }
        : { text: t('common.close'), callback_data: `spam_close${s}` };

    const keyboard = {
        inline_keyboard: [
            [{ text: `${t('antispam.buttons.monitor')}: ${enabled}`, callback_data: `spam_toggle${s}` }],
            [{ text: `${t('antispam.buttons.sensitivity')}: ${sensLabel}`, callback_data: `spam_sens${s}` }],
            [{ text: `${t('antispam.buttons.action_flood')}: ${actVol}`, callback_data: `spam_act_vol${s}` }],
            [{ text: `${t('antispam.buttons.action_repeat')}: ${actRep}`, callback_data: `spam_act_rep${s}` }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, statusText, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'anti-spam');
    } else {
        await ctx.reply(statusText, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = {
    sendConfigUI
};
