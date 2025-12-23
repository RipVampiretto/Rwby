const logger = require('../../middlewares/logger');
const { safeDelete } = require('../../utils/error-handlers');
const adminLogger = require('../admin-logger');
const superAdmin = require('../super-admin');

async function executeAction(ctx, config, keyword) {
    const user = ctx.from;

    // Parse log events
    let logEvents = {};
    if (config.log_events) {
        if (typeof config.log_events === 'string') {
            try { logEvents = JSON.parse(config.log_events); } catch (e) { }
        } else if (typeof config.log_events === 'object') {
            logEvents = config.log_events;
        }
    }

    // Always delete for global keywords
    await safeDelete(ctx, 'keyword-monitor');

    // Log only if enabled
    if (logEvents['keyword_delete'] && adminLogger.getLogEvent()) {
        adminLogger.getLogEvent()({
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

    logger.info(`[keyword-monitor] Deleted message from ${user.id} containing keyword: ${keyword}`);
}

module.exports = {
    executeAction
};
