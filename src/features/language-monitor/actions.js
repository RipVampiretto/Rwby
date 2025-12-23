const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');
const staffCoordination = require('../staff-coordination');
const i18n = require('../../i18n');
const { safeDelete, safeBan } = require('../../utils/error-handlers');

async function executeAction(ctx, config, detected, allowed) {
    const action = config.lang_action || 'delete';
    const user = ctx.from;
    const lang = ctx.lang || 'en';

    // Parse log events
    let logEvents = {};
    if (config.log_events) {
        if (typeof config.log_events === 'string') {
            try { logEvents = JSON.parse(config.log_events); } catch (e) { }
        } else if (typeof config.log_events === 'object') {
            logEvents = config.log_events;
        }
    }

    const logParams = {
        guildId: ctx.chat.id,
        guildName: ctx.chat.title,
        eventType: 'lang_delete',
        targetUser: user,
        reason: i18n.t(lang, 'language.log_reason', {
            detected: detected.toUpperCase(),
            allowed: allowed.join(', ').toUpperCase()
        }),
        isGlobal: action === 'ban'
    };

    // Get translation for this guild's UI language
    const userName = user.username ? `@${user.username}` : `<a href="tg://user?id=${user.id}">${user.first_name}</a>`;
    const warningMsg = i18n.t(ctx.lang || 'en', 'language.warning', {
        languages: allowed.join(', ').toUpperCase(),
        user: userName
    });

    if (action === 'delete') {
        await safeDelete(ctx, 'language-monitor');

        // Log only if enabled
        if (logEvents['lang_delete'] && adminLogger.getLogEvent()) {
            adminLogger.getLogEvent()(logParams);
        }

        // Send warning and auto-delete after 1 minute
        try {
            const warning = await ctx.reply(warningMsg, { parse_mode: 'HTML' });
            setTimeout(async () => {
                try {
                    await ctx.api.deleteMessage(ctx.chat.id, warning.message_id);
                } catch (e) { }
            }, 60000);
        } catch (e) { }
    } else if (action === 'ban') {
        await safeDelete(ctx, 'language-monitor');
        const banned = await safeBan(ctx, user.id, 'language-monitor');

        if (banned) {
            userReputation.modifyFlux(user.id, ctx.chat.id, -20, 'lang_ban');

            if (superAdmin.forwardBanToParliament) {
                superAdmin.forwardBanToParliament({
                    user: user,
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: i18n.t(lang, 'language.ban_reason', { detected: detected.toUpperCase() }),
                    evidence: ctx.message.text,
                    flux: userReputation.getLocalFlux(user.id, ctx.chat.id)
                });
            }

            // Log only if enabled
            if (logEvents['lang_ban'] && adminLogger.getLogEvent()) {
                logParams.eventType = 'ban';
                adminLogger.getLogEvent()(logParams);
            }
        }
    } else if (action === 'report_only') {
        const sent = await staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Language',
            user: user,
            reason: i18n.t(lang, 'language.log_reason', { detected: detected.toUpperCase(), allowed: allowed.join(', ').toUpperCase() }),
            messageId: ctx.message.message_id,
            content: ctx.message.text
        });

        // Log only if enabled and report was sent
        if (sent && logEvents['lang_report'] && adminLogger.getLogEvent()) {
            logParams.eventType = 'lang_report';
            adminLogger.getLogEvent()(logParams);
        }
    }
}

module.exports = {
    executeAction
};
