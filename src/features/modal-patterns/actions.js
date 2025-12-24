const logger = require('../../middlewares/logger');
const adminLogger = require('../admin-logger');
const superAdmin = require('../super-admin');
const staffCoordination = require('../staff-coordination');
const i18n = require('../../i18n');
const { safeDelete } = require('../../utils/error-handlers');

async function executeAction(ctx, action, category, pattern, similarity) {
    const user = ctx.from;
    const text = ctx.message.text || '';

    // Get config for log events
    const db = require('../../database');
    const config = await db.getGuildConfig(ctx.chat.id);
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

    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'modal_detect',
        targetUser: user,
        reason: `Pattern: ${category} (${Math.round(similarity * 100)}%)`,
        isGlobal: false
    };

    logger.info(
        `[modal-patterns] Match: ${category} | User: ${user.id} | Sim: ${Math.round(similarity * 100)}% | Action: ${action}`
    );

    if (action === 'delete') {
        // Forward text to Parliament BEFORE deleting
        if (superAdmin.forwardToParliament) {
            await superAdmin.forwardToParliament({
                type: 'modal_pattern',
                user: user,
                guildName: ctx.chat.title,
                guildId: ctx.chat.id,
                reason: `Pattern: ${category}`,
                evidence: text.substring(0, 500),
                similarity: Math.round(similarity * 100)
            });
        }

        // Delete message
        await safeDelete(ctx, 'modal-patterns');

        // Send warning to user (auto-delete after 1 minute)
        try {
            const lang = await i18n.getLanguage(ctx.chat.id);
            const userName = user.username
                ? `@${user.username}`
                : `<a href="tg://user?id=${user.id}">${user.first_name}</a>`;
            const warningMsg = i18n.t(lang, 'modals.warning', { user: userName });

            const warning = await ctx.reply(warningMsg, { parse_mode: 'HTML' });
            setTimeout(async () => {
                try {
                    await ctx.api.deleteMessage(ctx.chat.id, warning.message_id);
                } catch (e) {}
            }, 60000);
        } catch (e) {}

        // Log if enabled
        if (logEvents['modal_detect'] && adminLogger.getLogEvent()) {
            adminLogger.getLogEvent()(logParams);
        }
    } else if (action === 'report_only') {
        // Forward to staff group for review
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Pattern',
            user: user,
            reason: `Categoria: ${category}\nSimilarità: ${Math.round(similarity * 100)}%`,
            messageId: ctx.message.message_id,
            content: text
        });
    }
}

module.exports = {
    executeAction
};
