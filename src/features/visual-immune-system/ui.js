const { safeEdit } = require('../../utils/error-handlers');
const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);
    const enabled = config.visual_enabled ? t('common.on') : t('common.off');
    const sync = config.visual_sync_global ? t('common.on') : t('common.off');
    const action = i18n.formatAction(guildId, config.visual_action || 'delete');
    const thr = config.visual_hamming_threshold || 5;

    const text =
        `${t('visual.title')}\n\n` +
        `${t('visual.description')}\n\n` +
        `${t('visual.info_title')}\n` +
        `${t('visual.info_items.blocks')}\n` +
        `${t('visual.info_items.shares')}\n` +
        `${t('visual.info_items.fast')}\n\n` +
        `${t('visual.status')}: ${enabled}\n` +
        `${t('visual.global')}: ${sync}\n` +
        `${t('visual.action_label')}: ${action}\n` +
        `${t('visual.precision')}: ${thr}`;

    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: 'settings_main' }
        : { text: t('common.close'), callback_data: 'vis_close' };

    const keyboard = {
        inline_keyboard: [
            [
                { text: `${t('visual.buttons.system')}: ${enabled}`, callback_data: 'vis_toggle' },
                { text: `${t('visual.buttons.sync')}: ${sync}`, callback_data: 'vis_sync' }
            ],
            [{ text: `${t('visual.buttons.action')}: ${action}`, callback_data: 'vis_act' }],
            [{ text: `${t('visual.buttons.threshold')}: ${thr}`, callback_data: 'vis_thr' }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'visual-immune');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = {
    sendConfigUI
};
