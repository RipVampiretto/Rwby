const logger = require('../../middlewares/logger');
const actionLog = require('../action-log');
const superAdmin = require('../super-admin');
const i18n = require('../../i18n');
const { safeDelete } = require('../../utils/error-handlers');

let db = null;

function init(database) {
    db = database;
}

/**
 * Execute action based on mention filter verdict
 * @param {Object} ctx - Telegram context
 * @param {Object} config - Guild config
 * @param {Object} verdict - { type, username, userId, aiResult }
 */
async function executeAction(ctx, config, verdict) {
    const { type, username, userId, aiResult } = verdict;
    const user = ctx.from;
    const action = config.mention_filter_action || 'report_only';

    const lang = await i18n.getLanguage(ctx.chat.id);
    const t = (key, params) => i18n.t(lang, key, params);

    // Get log events config
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

    const userName = user.username ? `@${user.username}` : `<a href="tg://user?id=${user.id}">${user.first_name}</a>`;

    const reasonText =
        type === 'gbanned'
            ? t('mention.reason_gbanned', { user: username })
            : t('mention.reason_scam', { percent: Math.round(aiResult.confidence * 100), reason: aiResult.reason });

    // Log to group's log channel via ActionLog BEFORE action (to allow forwarding)
    if (config.mention_filter_notify && actionLog.getLogEvent()) {
        const eventType = action === 'delete' ? 'mention_delete' : 'mention_scam';

        // Await the log event to ensure forwarding happens before potential deletion
        await actionLog.getLogEvent()({
            guildId: ctx.chat.id,
            eventType: eventType,
            targetUser: user,
            // Reason suppressed in log but kept for Parliament
            reason: '',
            messageIdToForward: ctx.message.message_id,
            chatIdToForwardFrom: ctx.chat.id,
            extra: {
                mentionedUser: `@${username}`,
                confidence: aiResult?.confidence,
                aiReason: aiResult?.reason
            },
            isGlobal: false
        });
    }

    // Execute action based on config
    if (action === 'delete' || type === 'gbanned') {
        // Delete message
        await safeDelete(ctx, 'mention-filter');

        // Send warning to user (auto-delete after 1 minute)
        try {
            const warningText =
                type === 'gbanned'
                    ? t('mention.warning_gbanned', { user: userName, mentioned: `@${username}` })
                    : t('mention.warning_scam', { user: userName });

            const warning = await ctx.reply(warningText, { parse_mode: 'HTML' });
            setTimeout(async () => {
                try {
                    await ctx.api.deleteMessage(ctx.chat.id, warning.message_id);
                } catch (e) {}
            }, 60000); // 1 minute
        } catch (e) {
            logger.debug(`[mention-filter] Could not send warning: ${e.message}`);
        }

        logger.info(`[mention-filter] Deleted message from ${user.id} - ${reasonText}`);
    } else if (action === 'report_only' && config.staff_group_id) {
        // Report to staff group (not Parliament, that's separate)
        const messageText = ctx.message.text || ctx.message.caption || '[No text]';
        const chatIdStr = String(ctx.chat.id).replace('-100', '');
        const messageLink = `https://t.me/c/${chatIdStr}/${ctx.message.message_id}`;

        const staffAlertText =
            `${t('mention.staff_alert.title')}\n\n` +
            `${t('mention.staff_alert.group')}: ${ctx.chat.title}\n` +
            `${t('mention.staff_alert.user')}: ${userName} [<code>${user.id}</code>]\n` +
            `${t('mention.staff_alert.mentioned')}: @${username}\n\n` +
            `<a href="${messageLink}">${t('mention.staff_alert.go_to_message')}</a>`;

        try {
            await ctx.api.sendMessage(config.staff_group_id, staffAlertText, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: t('mention.staff_alert.btn_delete'),
                                callback_data: `mnt_staff_del:${ctx.chat.id}:${ctx.message.message_id}`
                            },
                            {
                                text: t('mention.staff_alert.btn_ignore'),
                                callback_data: `mnt_staff_ignore:${ctx.chat.id}`
                            }
                        ]
                    ]
                }
            });
            logger.info(`[mention-filter] Reported to staff group for ${user.id}`);
        } catch (e) {
            logger.warn(`[mention-filter] Could not send to staff group: ${e.message}`);
        }
    }

    // ALWAYS forward to Parliament for review (regardless of action)
    if (superAdmin.forwardToParliament) {
        const messageText = ctx.message.text || ctx.message.caption || '[No text]';

        superAdmin.forwardToParliament({
            topic: 'reports',
            type: type === 'gbanned' ? 'mention_gbanned' : 'mention_scam',
            user: user,
            guildName: ctx.chat.title,
            guildId: ctx.chat.id,
            messageId: ctx.message.message_id,
            reason: reasonText,
            evidence: `Message:\n${messageText}\n\nMentioned: @${username}${userId ? ` (${userId})` : ''}\nAI Confidence: ${Math.round((aiResult?.confidence || 0) * 100)}%`,
            extra: {
                mentionedUsername: username,
                mentionedUserId: userId,
                aiClassification: aiResult
            }
        });
    }
}

module.exports = {
    init,
    executeAction
};
