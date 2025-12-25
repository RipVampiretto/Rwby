const logger = require('../../middlewares/logger');
const actionLog = require('../action-log');
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
            } catch (e) { }
        } else if (typeof config.log_events === 'object') {
            logEvents = config.log_events;
        }
    }

    // Lazy require to avoid circular dependency
    const superAdmin = require('../super-admin');

    logger.info(
        `[spam-patterns] Match: ${category} | User: ${user.id} | Sim: ${Math.round(similarity * 100)}% | Action: ${action}`
    );

    if (action === 'delete') {
        // === MODAL_DELETE FLOW ===
        // 1. Delete message first
        await safeDelete(ctx, 'modal-patterns');

        // 2. Send warning to user (auto-delete after 1 minute)
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
                } catch (e) { }
            }, 60000);
        } catch (e) { }

        // 3. Send local log if enabled
        if (logEvents['modal_delete'] && actionLog.getLogEvent()) {
            const lang = await i18n.getLanguage(ctx.chat.id);
            const logReason = i18n.t(lang, 'modals.log_reason', { similarity: Math.round(similarity * 100) });
            actionLog.getLogEvent()({
                guildId: ctx.chat.id,
                eventType: 'modal_delete',
                targetUser: user,
                reason: logReason,
                isGlobal: false
            });
        }

        // 4. Forward to Parliament with gban/local options
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

    } else if (action === 'report_only') {
        // === MODAL_REPORT FLOW ===
        // 1. Send local log if enabled
        if (logEvents['modal_report'] && actionLog.getLogEvent()) {
            const lang = await i18n.getLanguage(ctx.chat.id);
            const logReason = i18n.t(lang, 'modals.log_reason', { similarity: Math.round(similarity * 100) });
            actionLog.getLogEvent()({
                guildId: ctx.chat.id,
                eventType: 'modal_report',
                targetUser: user,
                reason: logReason,
                isGlobal: false,
                // Forward the original message to log channel
                messageIdToForward: ctx.message.message_id,
                chatIdToForwardFrom: ctx.chat.id
            });
        }

        // 2. Send to staff group for review
        if (staffCoordination.reviewQueue) {
            staffCoordination.reviewQueue({
                guildId: ctx.chat.id,
                source: 'Pattern',
                user: user,
                reason: `Categoria: ${category}\nSimilarità: ${Math.round(similarity * 100)}%`,
                messageId: ctx.message.message_id,
                content: text
            });
        }

        // 3. Forward to Parliament with gban/local options
        if (superAdmin.forwardToParliament) {
            await superAdmin.forwardToParliament({
                type: 'modal_pattern',
                user: user,
                guildName: ctx.chat.title,
                guildId: ctx.chat.id,
                reason: `Pattern: ${category} (Report Only)`,
                evidence: text.substring(0, 500),
                similarity: Math.round(similarity * 100)
            });
        }
    }
}

module.exports = {
    executeAction
};
