const logger = require('../../middlewares/logger');
const { safeDelete, safeBan } = require('../../utils/error-handlers');
const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');

async function executeAction(ctx, action, keyword, fullText) {
    const user = ctx.from;

    // Determine eventType based on action
    const eventType = action === 'ban' ? 'keyword_ban' : 'keyword_delete';

    const logParams = {
        guildId: ctx.chat.id,
        eventType: eventType,
        targetUser: user,
        reason: `Keyword: ${keyword}`,
        isGlobal: (action === 'ban')
    };

    if (action === 'delete') {
        await safeDelete(ctx, 'keyword-monitor');
        if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
    }
    else if (action === 'ban') {
        await safeDelete(ctx, 'keyword-monitor');
        const banned = await safeBan(ctx, user.id, 'keyword-monitor');

        if (banned) {
            await ctx.reply(`🚫 **BANNED (Keyword)**\nTrigger: "||${keyword}||"`, { parse_mode: 'MarkdownV2' });
            userReputation.modifyFlux(user.id, ctx.chat.id, -50, 'keyword_ban');

            if (superAdmin.forwardBanToParliament) {
                superAdmin.forwardBanToParliament({
                    user: user,
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: `Keyword Ban: ${keyword}`,
                    evidence: fullText,
                    flux: userReputation.getLocalFlux(user.id, ctx.chat.id)
                });
            }

            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
        }
    }
    else if (action === 'report_only') {
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Keyword',
            user: user,
            reason: `Keyword: ${keyword}`,
            messageId: ctx.message.message_id,
            content: fullText
        });
    }
}

module.exports = {
    executeAction
};
