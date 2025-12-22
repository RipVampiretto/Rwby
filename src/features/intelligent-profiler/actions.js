const logger = require('../../middlewares/logger');
const { safeDelete, safeBan } = require('../../utils/error-handlers');
const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');

async function executeAction(ctx, action, reason, content) {
    const user = ctx.from;
    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'profiler_detect',
        targetUser: user,
        executorAdmin: null,
        reason: `Profiler: ${reason}`,
        isGlobal: action === 'ban'
    };

    if (action === 'delete') {
        await safeDelete(ctx, 'intelligent-profiler');
    } else if (action === 'ban') {
        await safeDelete(ctx, 'intelligent-profiler');
        const banned = await safeBan(ctx, user.id, 'intelligent-profiler');

        if (banned) {
            userReputation.modifyFlux(user.id, ctx.chat.id, -50, 'profiler_ban');

            if (superAdmin.forwardBanToParliament) {
                superAdmin.forwardBanToParliament({
                    user: user,
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: `Profiler Ban: ${reason}`,
                    evidence: content,
                    flux: userReputation.getLocalFlux(user.id, ctx.chat.id)
                });
            }

            logParams.eventType = 'ban';
            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
        }
    } else if (action === 'report_only') {
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Profiler',
            user: user,
            reason: `${reason}`,
            messageId: ctx.message.message_id,
            content: content
        });
    }
}

module.exports = {
    executeAction
};
