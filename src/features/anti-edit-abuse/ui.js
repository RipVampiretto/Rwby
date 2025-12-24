const i18n = require('../../i18n');
const { safeEdit } = require('../../utils/error-handlers');

async function sendConfigUI(ctx, db, isEdit = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);
    const enabled = config.edit_monitor_enabled ? t('common.on') : t('common.off');
    const action = i18n.formatAction(guildId, config.edit_action || 'delete');
    const gracePeriod = config.edit_grace_period ?? 0;
    const graceDisplay = gracePeriod === 0 ? t('common.off') : `${gracePeriod} min`;

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
    const logDel = logEvents['edit_delete'] ? '✅' : '❌';
    const logRep = logEvents['edit_report'] ? '✅' : '❌';

    let text =
        `${t('antiedit.title')}\n\n` +
        `${t('antiedit.description')}\n\n` +
        `ℹ️ **${t('antiedit.info_title')}:**\n` +
        `• ${t('antiedit.info_1')}\n` +
        `• ${t('antiedit.info_2')}\n` +
        `• ${t('antiedit.info_3')}\n\n` +
        `${t('antiedit.status')}: ${enabled}\n` +
        `${t('antiedit.action')}: ${action}\n` +
        `${t('antiedit.grace_period')}: ${graceDisplay}`;

    if (!config.staff_group_id && (config.edit_action || 'delete') === 'report_only') {
        text += `\n${t('common.warnings.no_staff_group')}\n`;
    }

    // Always show Back button
    const keyboard = {
        inline_keyboard: [
            [{ text: `${t('antiedit.buttons.monitor')}: ${enabled}`, callback_data: 'edt_toggle' }],
            [{ text: `${t('antiedit.buttons.action')}: ${action}`, callback_data: 'edt_act' }],
            [{ text: `${t('antiedit.buttons.grace')}: ${graceDisplay}`, callback_data: 'edt_grace' }],
            [
                { text: `Log 🗑️${logDel}`, callback_data: 'edt_log_delete' },
                { text: `Log 📢${logRep}`, callback_data: 'edt_log_report' }
            ],
            [{ text: t('common.back'), callback_data: 'settings_main' }]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'HTML' }, 'anti-edit');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    }
}

module.exports = {
    sendConfigUI
};
