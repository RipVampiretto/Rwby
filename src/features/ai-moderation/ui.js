const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const t = (key, params) => i18n.t(guildId, key, params);

    const config = await db.fetchGuildConfig(guildId);
    const enabled = config.ai_enabled ? t('common.on') : t('common.off');
    const tierBypass = config.ai_tier_bypass ?? 2;
    const thr = (config.ai_confidence_threshold || 0.75) * 100;

    let warning = '';
    // Warning for categories set to report_only without staff group
    const cats = ['scam', 'nsfw', 'spam', 'hate', 'threat'];
    let needsStaff = false;
    for (const cat of cats) {
        if ((config[`ai_action_${cat}`] || 'report_only') === 'report_only') needsStaff = true;
    }
    if (needsStaff && !config.staff_group_id) {
        warning = `\n${t('common.warnings.no_staff_group')}\n`;
    }

    const text =
        `${t('ai.title')}\n\n` +
        `${t('ai.description')}\n\n` +
        `ℹ️ **${t('ai.info_title')}:**\n` +
        `• ${t('ai.info_1')}\n` +
        `• ${t('ai.info_2')}\n` +
        `• ${t('ai.info_3')}\n\n` +
        `${t('ai.status')}: ${enabled}\n` +
        `${t('ai.tier_bypass')}: ${tierBypass}+\n` +
        `${t('ai.threshold')}: ${thr}%` +
        warning;

    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: 'settings_main' }
        : { text: t('common.close'), callback_data: 'ai_close' };

    const keyboard = {
        inline_keyboard: [
            [{ text: `${t('ai.buttons.system')}: ${enabled}`, callback_data: 'ai_toggle' }],
            [
                {
                    text: `${t('ai.buttons.context')}: ${config.ai_context_aware ? 'ON' : 'OFF'}`,
                    callback_data: 'ai_ctx'
                }
            ],
            [
                {
                    text: `${t('ai.buttons.tier')}: ${tierBypass === -1 ? 'OFF' : tierBypass + '+'}`,
                    callback_data: 'ai_tier_bypass'
                }
            ],
            [{ text: t('ai.buttons.categories'), callback_data: 'ai_config_cats' }],
            [{ text: `${t('ai.buttons.threshold')}: ${thr}%`, callback_data: 'ai_threshold' }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        try {
            await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
        } catch (e) {}
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

async function sendCategoryConfigUI(ctx, db, fromSettings = false) {
    const guildId = ctx.chat.id;
    const t = (key, params) => i18n.t(guildId, key, params);

    const config = await db.fetchGuildConfig(guildId);
    const cats = ['scam', 'nsfw', 'spam'];

    const rows = [];
    for (const cat of cats) {
        const action = (config[`ai_action_${cat}`] || 'report_only').toUpperCase().replace('_', ' ');
        rows.push([{ text: `${cat.toUpperCase()}: ${action}`, callback_data: `ai_set_act:${cat}` }]);
    }
    rows.push([{ text: t('common.back'), callback_data: 'ai_back_main' }]);

    const text = `${t('ai.categories.title')}\n${t('ai.categories.subtitle')}`;
    try {
        await ctx.editMessageText(text, { reply_markup: { inline_keyboard: rows }, parse_mode: 'Markdown' });
    } catch (e) {}
}

module.exports = {
    sendConfigUI,
    sendCategoryConfigUI
};
