const { safeEdit } = require('../../utils/error-handlers');
const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);
    const enabled = config.link_enabled ? t('common.on') : t('common.off');
    const sync = config.link_sync_global ? t('common.on') : t('common.off');
    const tierBypass = config.link_tier_bypass ?? 2;

    let text =
        `${t('link.title')}\n\n` +
        `${t('link.description')}\n\n` +
        `ℹ️ **${t('link.info_title')}:**\n` +
        `• ${t('link.info_1')}\n` +
        `• ${t('link.info_2')}\n\n` +
        `${t('link.status')}: ${enabled}\n` +
        `${t('link.tier_bypass')}: ${tierBypass === -1 ? 'OFF' : tierBypass + '+'}\n` +
        `${t('link.global_sync')}: ${sync}`;

    // Add warning if action is report_only (unknown links are reported by default if not blocked)
    if (!config.staff_group_id && (config.link_action_unknown || 'report_only') === 'report_only') {
        text += `\n${t('common.warnings.no_staff_group')}\n`;
    }

    // Parse log events
    let logEvents = {};
    if (config.log_events) {
        if (typeof config.log_events === 'string') {
            try { logEvents = JSON.parse(config.log_events); } catch (e) { }
        } else if (typeof config.log_events === 'object') {
            logEvents = config.log_events;
        }
    }
    const logDel = logEvents['link_delete'] ? '✅' : '❌';

    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: 'settings_main' }
        : { text: t('common.close'), callback_data: 'lnk_close' };

    const keyboard = {
        inline_keyboard: [
            [{ text: `${t('link.buttons.monitor')}: ${enabled}`, callback_data: 'lnk_toggle' }],
            [{ text: `${t('link.buttons.tier')}: ${tierBypass}+`, callback_data: 'lnk_tier' }],
            [{ text: `${t('link.buttons.sync')}: ${sync}`, callback_data: 'lnk_sync' }],
            // Log toggles
            [{ text: `📋 Log 🗑️${logDel}`, callback_data: 'lnk_log_delete' }],
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
