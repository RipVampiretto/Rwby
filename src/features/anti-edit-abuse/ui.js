const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const t = (key, params) => i18n.t(guildId, key, params);

    const config = db.getGuildConfig(guildId);
    const enabled = config.edit_monitor_enabled ? t('common.on') : t('common.off');
    const lockT0 = config.edit_lock_tier0 ? t('common.on') : t('common.off');
    const thr = (config.edit_similarity_threshold || 0.5) * 100;
    const actInj = (config.edit_link_injection_action || 'report_only').toUpperCase().replace('_', ' ');
    const actGen = (config.edit_abuse_action || 'report_only').toUpperCase().replace('_', ' ');
    const tierBypass = config.edit_tier_bypass ?? 2;

    const text = `${t('antiedit.title')}\n\n` +
        `${t('antiedit.description')}\n\n` +
        `ℹ️ **${t('antiedit.info_title')}:**\n` +
        `• ${t('antiedit.info_1')}\n` +
        `• ${t('antiedit.info_2')}\n\n` +
        `${t('antiedit.status')}: ${enabled}\n` +
        `${t('antiedit.tier_bypass')}: ${tierBypass === -1 ? 'OFF' : tierBypass + '+'}\n` +
        `${t('antiedit.threshold')}: ${thr}%\n` +
        `${t('antiedit.action_injection')}: ${actInj}\n` +
        `${t('antiedit.action_other')}: ${actGen}`;

    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: "settings_main" }
        : { text: t('common.close'), callback_data: "edt_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `${t('antiedit.buttons.monitor')}: ${enabled}`, callback_data: "edt_toggle" }],
            [{ text: `${t('antiedit.buttons.tier')}: ${tierBypass}+`, callback_data: "edt_tier" }],
            [{ text: `${t('antiedit.buttons.threshold')}: ${thr}%`, callback_data: "edt_thr" }],
            [{ text: `${t('antiedit.buttons.action_inj')}: ${actInj}`, callback_data: "edt_act_inj" }],
            [{ text: `${t('antiedit.buttons.action_gen')}: ${actGen}`, callback_data: "edt_act_gen" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        try { await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' }); } catch (e) { }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = {
    sendConfigUI
};
