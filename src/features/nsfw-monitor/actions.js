const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');
const staffCoordination = require('../staff-coordination');
const { safeDelete, safeBan } = require('../../utils/error-handlers');

async function executeAction(ctx, action, reason, type) {
    const user = ctx.from;

    // Determine eventType based on action
    const eventType = action === 'ban' ? 'nsfw_ban' : 'nsfw_delete';

    const logParams = {
        guildId: ctx.chat.id,
        eventType: eventType,
        targetUser: user,
        reason: `NSFW (${type}): ${reason}`,
        isGlobal: action === 'ban'
    };

    if (action === 'delete') {
        // Forward original media to Parliament BEFORE deleting
        if (superAdmin.forwardMediaToParliament) {
            const caption = `🖼️ NSFW Detected\n\nGruppo: ${ctx.chat.title}\nUser: ${user.first_name} (@${user.username || 'N/A'})\nUser ID: ${user.id}\nResult: ${reason}\nAction: DELETE`;
            await superAdmin.forwardMediaToParliament('image_spam', ctx, caption);
        }

        await safeDelete(ctx, 'nsfw-monitor');
        if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
    } else if (action === 'ban') {
        // Forward original media to Parliament BEFORE deleting
        if (superAdmin.forwardMediaToParliament) {
            const caption = `🖼️ NSFW Detected + BAN\n\nGruppo: ${ctx.chat.title}\nUser: ${user.first_name} (@${user.username || 'N/A'})\nUser ID: ${user.id}\nResult: ${reason}\nAction: BAN`;
            await superAdmin.forwardMediaToParliament('image_spam', ctx, caption);
        }

        await safeDelete(ctx, 'nsfw-monitor');
        const banned = await safeBan(ctx, user.id, 'nsfw-monitor');

        if (banned) {
            userReputation.modifyFlux(user.id, ctx.chat.id, -100, 'nsfw_ban');

            if (superAdmin.forwardBanToParliament) {
                superAdmin.forwardBanToParliament({
                    user: user,
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: `NSFW Ban: ${reason}`,
                    evidence: `Check ${type}`,
                    flux: userReputation.getLocalFlux(user.id, ctx.chat.id)
                });
            }
            logParams.eventType = 'ban';
            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
        }
    } else if (action === 'report_only') {
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'NSFW-Mon',
            user: user,
            reason: `${reason}`,
            messageId: ctx.message.message_id,
            content: `[Media ${type}]`
        });
    }
}

module.exports = {
    executeAction
};
