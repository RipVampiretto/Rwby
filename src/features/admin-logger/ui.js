const logger = require('../../middlewares/logger');
const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const t = (key, params) => i18n.t(guildId, key, params);

    const config = await db.fetchGuildConfig(guildId);

    let logEvents = {};
    if (config.log_events) {
        try { logEvents = JSON.parse(config.log_events); } catch (e) { }
        if (Array.isArray(logEvents)) logEvents = {};
    }

    const has = (key) => logEvents[key] ? '✅' : '❌';

    const channelInfo = config.log_channel_id ? t('logger.channel_set') : t('logger.channel_not_set');
    const text = `${t('logger.title')}\n\n` +
        `${t('logger.description')}\n\n` +
        `${t('logger.channel')}: ${channelInfo}\n\n` +
        `${t('logger.enable_logs')}`;

    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: "settings_main" }
        : { text: t('common.close'), callback_data: "log_close" };

    // Matrix layout: each row = module with delete/ban toggles
    const keyboard = {
        inline_keyboard: [
            [{ text: t('logger.set_channel'), callback_data: "log_set_channel" }],
            // Header row
            [{ text: t('logger.header_module'), callback_data: "log_noop" }, { text: t('logger.header_delete'), callback_data: "log_noop" }, { text: t('logger.header_ban'), callback_data: "log_noop" }],
            // Lang
            [{ text: "🌐 Lang", callback_data: "log_noop" }, { text: has('lang_delete'), callback_data: "log_t:lang_delete" }, { text: has('lang_ban'), callback_data: "log_t:lang_ban" }],
            // NSFW
            [{ text: "🔞 NSFW", callback_data: "log_noop" }, { text: has('nsfw_delete'), callback_data: "log_t:nsfw_delete" }, { text: has('nsfw_ban'), callback_data: "log_t:nsfw_ban" }],
            // Link
            [{ text: "🔗 Link", callback_data: "log_noop" }, { text: has('link_delete'), callback_data: "log_t:link_delete" }, { text: "—", callback_data: "log_noop" }],
            // AI
            [{ text: "🤖 AI", callback_data: "log_noop" }, { text: has('ai_delete'), callback_data: "log_t:ai_delete" }, { text: has('ai_ban'), callback_data: "log_t:ai_ban" }],
            // Vote
            [{ text: "⚖️ Vote", callback_data: "log_noop" }, { text: "—", callback_data: "log_noop" }, { text: has('vote_ban'), callback_data: "log_t:vote_ban" }],
            // Keyword
            [{ text: "🔤 Keys", callback_data: "log_noop" }, { text: has('keyword_delete'), callback_data: "log_t:keyword_delete" }, { text: has('keyword_ban'), callback_data: "log_t:keyword_ban" }],
            // Staff
            [{ text: "👮 Staff", callback_data: "log_noop" }, { text: has('staff_delete'), callback_data: "log_t:staff_delete" }, { text: has('staff_ban'), callback_data: "log_t:staff_ban" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        try {
            await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
        } catch (e) {
            logger.error(`[admin-logger] sendConfigUI error: ${e.message}`);
        }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = {
    sendConfigUI
};
