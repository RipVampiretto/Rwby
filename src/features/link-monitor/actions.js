const logger = require('../../middlewares/logger');
const adminLogger = require('../admin-logger');
const superAdmin = require('../super-admin');
const i18n = require('../../i18n');
const { safeDelete } = require('../../utils/error-handlers');

let db = null;

function init(database) {
    db = database;
}

async function executeAction(ctx, verdict) {
    const { type, domain, link } = verdict;
    const user = ctx.from;

    // Get config for log events
    const config = db ? await db.getGuildConfig(ctx.chat.id) : {};
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

    if (type === 'blacklist') {
        // Blacklisted domain - delete message
        await safeDelete(ctx, 'link-monitor');

        // Send warning to user (auto-delete after 1 minute)
        try {
            const lang = await i18n.getLanguage(ctx.chat.id);
            const userName = user.username
                ? `@${user.username}`
                : `<a href="tg://user?id=${user.id}">${user.first_name}</a>`;
            const warningMsg = i18n.t(lang, 'link.warning', { user: userName });

            const warning = await ctx.reply(warningMsg, { parse_mode: 'HTML' });
            setTimeout(async () => {
                try {
                    await ctx.api.deleteMessage(ctx.chat.id, warning.message_id);
                } catch (e) {}
            }, 60000); // 1 minute
        } catch (e) {}

        // Log only if enabled
        if (logEvents['link_delete'] && adminLogger.getLogEvent()) {
            adminLogger.getLogEvent()({
                guildId: ctx.chat.id,
                eventType: 'link_delete',
                targetUser: user,
                reason: `Blacklisted domain: ${domain}`,
                isGlobal: false
            });
        }

        // Forward to Parliament for potential gban
        if (superAdmin.forwardToParliament) {
            superAdmin.forwardToParliament({
                topic: 'reports',
                type: 'link_blacklist',
                user: user,
                guildName: ctx.chat.title,
                guildId: ctx.chat.id,
                reason: `Link a dominio bannato: ${domain}`,
                evidence: link
            });
        }

        logger.info(`[link-monitor] Deleted blacklisted link from ${user.id}: ${domain}`);
    } else if (type === 'unknown') {
        // Unknown domain - don't delete, just forward to Parliament for review
        if (superAdmin.forwardToParliament) {
            superAdmin.forwardToParliament({
                topic: 'link_checks',
                type: 'link_unknown',
                user: user,
                guildName: ctx.chat.title,
                guildId: ctx.chat.id,
                messageId: ctx.message.message_id,
                reason: `Dominio sconosciuto: ${domain}`,
                evidence: link
            });
        }

        logger.debug(`[link-monitor] Unknown domain forwarded to Parliament: ${domain}`);
    }
}

module.exports = {
    init,
    executeAction
};
