const adminLogger = require('../admin-logger');
const superAdmin = require('../super-admin');
const { safeDelete } = require('../../utils/error-handlers');

async function executeAction(ctx, verdict) {
    const { type, domain, link } = verdict;

    if (type === 'blacklist') {
        // Blacklisted domain - delete message
        await safeDelete(ctx, 'link-monitor');

        // Log the action
        if (adminLogger.getLogEvent()) {
            adminLogger.getLogEvent()({
                guildId: ctx.chat.id,
                eventType: 'link_delete',
                targetUser: ctx.from,
                reason: `Blacklisted domain: ${domain}`,
                isGlobal: false
            });
        }

        // Log to super admin
        if (superAdmin.sendGlobalLog) {
            superAdmin.sendGlobalLog('link_checks', `🚫 **Link Blacklist**\nGruppo: ${ctx.chat.title}\nUser: @${ctx.from.username || ctx.from.first_name}\nLink: ${link}\nDominio: ${domain}`);
        }
    }
    else if (type === 'unknown') {
        // Unknown domain - forward to Parliament for review (don't delete)
        if (superAdmin.forwardLinkCheck) {
            superAdmin.forwardLinkCheck({
                user: ctx.from,
                guildName: ctx.chat.title,
                guildId: ctx.chat.id,
                messageId: ctx.message.message_id,
                link: link
            });
        }

        // Log unknown
        if (superAdmin.sendGlobalLog) {
            superAdmin.sendGlobalLog('link_checks', `🔗 **Link Unknown**\nGruppo: ${ctx.chat.title}\nUser: @${ctx.from.username || ctx.from.first_name}\nLink: ${link}\nDominio: ${domain}`);
        }
    }
}

module.exports = {
    executeAction
};
