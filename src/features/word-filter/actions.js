const logger = require('../../middlewares/logger');
const { safeDelete } = require('../../utils/error-handlers');
const actionLog = require('../action-log');
const superAdmin = require('../super-admin');
const i18n = require('../../i18n');

async function executeAction(ctx, config, keyword) {
    const user = ctx.from;

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

    // Always delete for global keywords
    await safeDelete(ctx, 'keyword-monitor');

    // Send warning to user (auto-delete after 1 minute)
    try {
        const lang = await i18n.getLanguage(ctx.chat.id);
        const userName = user.username
            ? `@${user.username}`
            : `<a href="tg://user?id=${user.id}">${user.first_name}</a>`;
        const warningMsg = i18n.t(lang, 'keyword.warning', { user: userName });

        const warning = await ctx.reply(warningMsg, { parse_mode: 'HTML' });
        setTimeout(async () => {
            try {
                await ctx.api.deleteMessage(ctx.chat.id, warning.message_id);
            } catch (e) {}
        }, 60000); // 1 minute
    } catch (e) {}

    // Log only if enabled
    if (logEvents['keyword_delete'] && actionLog.getLogEvent()) {
        actionLog.getLogEvent()({
            guildId: ctx.chat.id,
            eventType: 'keyword_delete',
            targetUser: user,
            reason: `Keyword: ${keyword}`,
            isGlobal: false
        });
    }

    // Forward to Parliament for human review (potential gban)
    if (superAdmin.forwardToParliament) {
        superAdmin.forwardToParliament({
            topic: 'reports',
            type: 'keyword',
            user: user,
            guildName: ctx.chat.title,
            guildId: ctx.chat.id,
            reason: `Keyword bandita: ${keyword}`,
            evidence: ctx.message?.text || 'N/A'
        });
    }

    logger.info(`[word-filter] Deleted message from ${user.id} containing keyword: ${keyword}`);
}

module.exports = {
    executeAction
};
