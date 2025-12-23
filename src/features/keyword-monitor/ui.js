const { safeEdit } = require('../../utils/error-handlers');
const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);
    const syncGlobal = config.keyword_sync_global ? t('common.on') : t('common.off');

    const text =
        `${t('keyword.title')}\n\n` +
        `${t('keyword.description')}\n\n` +
        `ℹ️ **${t('keyword.info_title')}:**\n` +
        `• ${t('keyword.info_1')}\n\n` +
        `${t('keyword.global_sync')}: ${syncGlobal}`;

    // Parse log events
    let logEvents = {};
    if (config.log_events) {
        if (typeof config.log_events === 'string') {
            try { logEvents = JSON.parse(config.log_events); } catch (e) { }
        } else if (typeof config.log_events === 'object') {
            logEvents = config.log_events;
        }
    }
    const logDel = logEvents['keyword_delete'] ? '✅' : '❌';
    const logBan = logEvents['keyword_ban'] ? '✅' : '❌';

    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: 'settings_main' }
        : { text: t('common.close'), callback_data: 'wrd_close' };

    const keyboard = {
        inline_keyboard: [
            [{ text: `${t('keyword.buttons.sync')}: ${syncGlobal}`, callback_data: 'wrd_sync' }],
            // Log toggles
            [
                { text: `📋 Log 🗑️${logDel}`, callback_data: 'wrd_log_delete' },
                { text: `📋 Log 🚷${logBan}`, callback_data: 'wrd_log_ban' }
            ],
            [closeBtn]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'keyword-monitor');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = {
    sendConfigUI
};
