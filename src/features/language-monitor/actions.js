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

    // Determine eventType based on action
    const eventType = action === 'ban' ? 'lang_ban' : 'lang_delete';

    const logParams = {
        guildId: ctx.chat.id,
        guildName: ctx.chat.title,
        eventType: eventType,
        targetUser: user,
        reason: i18n.t(lang, 'language.log_reason', {
            detected: detected.toUpperCase(),
            allowed: allowed.join(', ').toUpperCase()
        }),
        isGlobal: action === 'ban'
    };

    // Get translation for this guild's UI language
    // Use HTML format for user mention to work properly
    const userName = user.username ? `@${user.username}` : `<a href="tg://user?id=${user.id}">${user.first_name}</a>`;
    const warningMsg = i18n.t(ctx.lang || 'en', 'language.warning', {
        languages: allowed.join(', ').toUpperCase(),
        user: userName
    });

    if (action === 'delete') {
        await safeDelete(ctx, 'language-monitor');
        if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);

        // Send warning and auto-delete after 1 minute
        try {
            const warning = await ctx.reply(warningMsg, { parse_mode: 'HTML' });
            setTimeout(async () => {
                try {
                    await ctx.api.deleteMessage(ctx.chat.id, warning.message_id);
                } catch (e) { }
            }, 60000); // 1 minute
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

            logParams.eventType = 'ban';
            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
        }
    } else if (action === 'report_only') {
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Language',
            user: user,
            reason: i18n.t(lang, 'language.log_reason', { detected: detected.toUpperCase(), allowed: allowed.join(', ').toUpperCase() }),
            messageId: ctx.message.message_id,
            content: ctx.message.text
        });
    }
}

module.exports = {
    executeAction
};
