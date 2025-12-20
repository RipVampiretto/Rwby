const logger = require('../../middlewares/logger');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');
const staffCoordination = require('../staff-coordination');
const { safeDelete, safeBan } = require('../../utils/error-handlers');

async function executeAction(ctx, action, category, pattern, similarity) {
    const user = ctx.from;
    const text = ctx.message.text || '';

    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'modal_detect',
        targetUser: user,
        executorAdmin: null,
        reason: `Modal: ${category} (${Math.round(similarity * 100)}% match)`,
        isGlobal: (action === 'ban')
    };

    logger.info(`[modal-patterns] Match: ${category} | User: ${user.id} | Sim: ${Math.round(similarity * 100)}% | Action: ${action}`);

    if (action === 'delete') {
        await safeDelete(ctx, 'modal-patterns');
    }
    else if (action === 'ban') {
        await safeDelete(ctx, 'modal-patterns');
        const banned = await safeBan(ctx, user.id, 'modal-patterns');

        if (banned) {
            userReputation.modifyFlux(user.id, ctx.chat.id, -50, 'modal_ban');

            if (superAdmin.forwardBanToParliament) {
                superAdmin.forwardBanToParliament({
                    user: user,
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: `Modal Ban: ${category} pattern`,
                    evidence: text.substring(0, 300),
                    flux: userReputation.getLocalFlux(user.id, ctx.chat.id)
                });
            }

            logParams.eventType = 'ban';
            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
        }
    }
    else if (action === 'report_only') {
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Modal Pattern',
            user: user,
            reason: `Category: ${category}\nPattern: "${pattern}"\nSimilarity: ${Math.round(similarity * 100)}%`,
            messageId: ctx.message.message_id,
            content: text
        });
    }
}

module.exports = {
    executeAction
};
