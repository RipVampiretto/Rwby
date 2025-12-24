const logic = require('./logic');
const ui = require('./ui');
const { safeBan } = require('../../utils/error-handlers');
const actionLog = require('../action-log');
const superAdmin = require('../super-admin');
const logger = require('../../middlewares/logger');
const i18n = require('../../i18n');

// Track pending confirmations: `chatId:targetId` -> { timeout, msgId, initiatorId }
const PENDING_CONFIRMATIONS = new Map();

// Helper: Setup 2-minute confirmation timeout
function setupConfirmationTimeout(ctx, target, confirmMsg, reason) {
    const key = `${ctx.chat.id}:${target.id}`;
    if (PENDING_CONFIRMATIONS.has(key)) {
        clearTimeout(PENDING_CONFIRMATIONS.get(key).timeout);
    }

    const timeoutHandle = setTimeout(async () => {
        PENDING_CONFIRMATIONS.delete(key);
        try {
            await ctx.api.deleteMessage(ctx.chat.id, confirmMsg.message_id);
        } catch (e) {}
        logger.info(`[report-system] Confirmation timeout for ${target.id}`);
    }, 120000); // 2 minutes

    PENDING_CONFIRMATIONS.set(key, {
        timeout: timeoutHandle,
        msgId: confirmMsg.message_id,
        initiatorId: ctx.from.id,
        targetMsgId: ctx.message?.reply_to_message?.message_id,
        reason: reason
    });
}

function registerCommands(bot, db) {
    // Trigger: @admin, etc. (Smart Report System)
    bot.on('message:text', async (ctx, next) => {
        const text = ctx.message.text.toLowerCase().trim();
        const triggers = ['@admin', '!admin', '.admin', '/admin'];

        if (!triggers.some(t => text.startsWith(t))) {
            return next();
        }

        if (ctx.chat.type === 'private') return next();

        const config = await db.getGuildConfig(ctx.chat.id);
        const votebanEnabled = config.report_enabled;

        if (!votebanEnabled) return next();

        // Must reply to a message
        if (!ctx.message.reply_to_message) {
            const lang = await i18n.getLanguage(ctx.chat.id);
            const notifyMsg = await ctx.reply(i18n.t(lang, 'report.errors.reply_required'));
            setTimeout(async () => {
                try {
                    await ctx.api.deleteMessage(ctx.chat.id, notifyMsg.message_id);
                } catch (e) {}
            }, 60000);
            return;
        }

        const targetMsg = ctx.message.reply_to_message;
        const target = targetMsg.from;

        if (target.is_bot) return;
        if (target.id === ctx.from.id) return;

        // Check admin bypass
        try {
            const member = await ctx.getChatMember(target.id);
            if (['creator', 'administrator'].includes(member.status)) {
                return;
            }
        } catch (e) {}

        // Check for existing vote
        const existing = await logic.getActiveVoteForUser(db, ctx.chat.id, target.id);
        if (existing) {
            const lang = await i18n.getLanguage(ctx.chat.id);
            return ctx.reply(i18n.t(lang, 'report.errors.already_active'), {
                reply_to_message_id: existing.poll_message_id
            });
        }

        const lang = await i18n.getLanguage(ctx.chat.id);
        const reason = text.replace(/^[@!./]admin\s*/i, '').trim() || i18n.t(lang, 'report.no_reason');

        // Check report mode
        const reportMode = config.report_mode || 'vote';

        if (reportMode === 'report') {
            // MODE: Report only - send to staff group, no voting
            logger.info(`[report] Report mode - sending to staff for ${target.id}`);

            const staffGroupId = config.staff_group_id;
            if (!staffGroupId) {
                const notifyMsg = await ctx.reply(i18n.t(lang, 'common.warnings.no_staff_group'), {
                    parse_mode: 'HTML'
                });
                setTimeout(async () => {
                    try {
                        await ctx.api.deleteMessage(ctx.chat.id, notifyMsg.message_id);
                    } catch (e) {}
                }, 60000);
                return;
            }

            // Build message link
            const chatIdStr = String(ctx.chat.id).replace('-100', '');
            const messageLink = `https://t.me/c/${chatIdStr}/${targetMsg.message_id}`;

            // Build alert message with localization
            const t = (key, params) => i18n.t(lang, key, params);
            const reporterName = ctx.from.first_name;
            const targetName = target.first_name;

            const alertText = t('report.staff_alert.message', {
                reporter: reporterName,
                reporterId: ctx.from.id,
                group: ctx.chat.title,
                target: targetName,
                targetId: target.id,
                link: messageLink
            });

            const alertKeyboard = {
                inline_keyboard: [
                    [{ text: t('report.staff_alert.btn_resolved'), callback_data: `report_resolved:${ctx.chat.id}` }]
                ]
            };

            await ctx.api.sendMessage(staffGroupId, alertText, {
                reply_markup: alertKeyboard,
                parse_mode: 'HTML'
            });

            // Log if enabled
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

            if (logEvents['report_log'] && config.log_channel_id) {
                const logText = t('report.log_message', {
                    reporter: reporterName,
                    reporterId: ctx.from.id,
                    target: targetName,
                    targetId: target.id,
                    group: ctx.chat.title,
                    groupId: ctx.chat.id,
                    link: messageLink
                });

                // Forward message to log channel first
                try {
                    await ctx.api.forwardMessage(config.log_channel_id, ctx.chat.id, targetMsg.message_id);
                } catch (e) {}

                await ctx.api.sendMessage(config.log_channel_id, logText, { parse_mode: 'HTML' });
            }

            // Show confirmation message (auto-delete 5 min)
            const notifyMsg = await ctx.reply(t('report.log.report_sent_to_staff'), { parse_mode: 'HTML' });
            setTimeout(async () => {
                try {
                    await ctx.api.deleteMessage(ctx.chat.id, notifyMsg.message_id);
                } catch (e) {}
            }, 300000); // 5 minutes

            return;
        }

        // MODE: Vote - show confirmation prompt for voting
        logger.info(`[report] Vote mode - showing confirmation for ${target.id}`);
        const confirmMsg = await ui.sendConfirmationPrompt(ctx, target, targetMsg.message_id);
        setupConfirmationTimeout(ctx, target, confirmMsg, reason);
    });

    // Callback handlers
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;

        // VoteBan Confirmation Handler
        if (data.startsWith('vb_confirm:')) {
            const parts = data.split(':');
            const action = parts[1]; // delete | ban | cancel
            const targetId = parseInt(parts[2]);
            const targetMsgId = parseInt(parts[3]);
            const initiatorId = parseInt(parts[4]);

            // Only initiator can confirm
            if (ctx.from.id !== initiatorId) {
                const lang = await i18n.getLanguage(ctx.chat.id);
                return ctx.answerCallbackQuery(i18n.t(lang, 'report.errors.not_initiator'));
            }

            const key = `${ctx.chat.id}:${targetId}`;
            const pending = PENDING_CONFIRMATIONS.get(key);

            if (!pending) {
                return ctx.answerCallbackQuery('⏱️ Timeout');
            }

            clearTimeout(pending.timeout);
            PENDING_CONFIRMATIONS.delete(key);

            if (action === 'cancel') {
                await ctx.deleteMessage();
                return ctx.answerCallbackQuery('❌ Annullato');
            }

            // Start VoteBan with chosen action type
            const config = await db.getGuildConfig(ctx.chat.id);
            const duration = config.report_duration || 30;
            const required = config.report_threshold || 5;
            const expires =
                duration === 0
                    ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
                    : new Date(Date.now() + duration * 60000).toISOString();

            // Get target user info
            let targetUser;
            try {
                const member = await ctx.getChatMember(targetId);
                targetUser = member.user;
            } catch (e) {
                targetUser = { id: targetId, first_name: `User ${targetId}` };
            }

            const voters = [{ id: ctx.from.id, name: ctx.from.first_name, vote: 'yes' }];

            const voteId = await logic.createVote(db, {
                target: targetUser,
                chat: ctx.chat,
                initiator: ctx.from,
                reason: pending.reason,
                required,
                expires,
                voters,
                actionType: action // 'delete' or 'ban'
            });

            const { text: msgText, keyboard } = await ui.getVoteMessage(
                ctx.chat.id,
                targetUser,
                ctx.from,
                action,
                1,
                0,
                required,
                expires,
                voteId
            );

            // Delete confirmation message and send vote as reply to the reported message
            await ctx.deleteMessage();
            const voteMsg = await ctx.api.sendMessage(ctx.chat.id, msgText, {
                reply_markup: keyboard,
                parse_mode: 'HTML',
                reply_to_message_id: pending.targetMsgId
            });
            await logic.setPollMessageId(db, voteId, voteMsg.message_id);
            await ctx.answerCallbackQuery();
            return;
        }

        // Report Resolved Handler (staff group)
        if (data.startsWith('report_resolved:')) {
            const msg = ctx.callbackQuery.message;
            const adminName = ctx.from.first_name;
            const adminId = ctx.from.id;

            // Get language from staff group
            const lang = await i18n.getLanguage(ctx.chat.id);

            // Get current text and append resolved info with HTML code tag
            const currentText = msg.text || '';
            const newText = currentText + `\n\n~ ✅ ${adminName} [<code>${adminId}</code>]`;

            // Edit message: remove keyboard, append admin info
            await ctx.editMessageText(newText, { parse_mode: 'HTML' });
            await ctx.answerCallbackQuery(i18n.t(lang, 'report.staff_alert.resolved_toast'));
            return;
        }

        // Config Handlers
        if (data.startsWith('vb_')) {
            const config = await db.getGuildConfig(ctx.chat.id);

            if (data === 'vb_toggle') {
                await db.updateGuildConfig(ctx.chat.id, { report_enabled: config.report_enabled ? 0 : 1 });
            } else if (data === 'vb_thr') {
                const val = config.report_threshold || 5;
                const thresholds = [3, 5, 7, 10];
                const idx = thresholds.indexOf(val);
                const nextVal = thresholds[(idx + 1) % thresholds.length];
                await db.updateGuildConfig(ctx.chat.id, { report_threshold: nextVal });
            } else if (data === 'vb_dur') {
                const val = config.report_duration;
                const durations = [15, 30, 60, 0];
                const idx = durations.indexOf(val);
                const nextVal = durations[(idx + 1) % durations.length];
                await db.updateGuildConfig(ctx.chat.id, { report_duration: nextVal });
            } else if (data === 'vb_mode') {
                // Simple toggle between vote and report
                const val = config.report_mode || 'vote';
                const modes = ['vote', 'report'];
                let idx = modes.indexOf(val);
                if (idx === -1) idx = 0; // Handle legacy AI mode values
                const nextVal = modes[(idx + 1) % modes.length];
                await db.updateGuildConfig(ctx.chat.id, { report_mode: nextVal });
            } else if (data === 'vb_log_ban' || data === 'vb_log_delete' || data === 'vb_log_report') {
                const logTypeMap = {
                    vb_log_ban: 'vote_ban',
                    vb_log_delete: 'vote_delete',
                    vb_log_report: 'report_log'
                };
                const logType = logTypeMap[data];
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
                logEvents[logType] = !logEvents[logType];
                await db.updateGuildConfig(ctx.chat.id, { log_events: logEvents });
            }
            // Category handlers removed (AI related)

            await ui.sendConfigUI(ctx, db, true);
            return;
        }
        if (data.startsWith('vote_')) {
            const parts = data.split('_');
            const voteType = parts[1]; // 'yes' or 'no'
            const voteId = parseInt(parts[2]);

            const vote = await logic.getVote(db, voteId);
            if (!vote || vote.status !== 'active') {
                return ctx.answerCallbackQuery('❌ Votazione terminata');
            }

            // Check if already voted
            let voters = vote.voters || [];
            if (typeof voters === 'string') {
                try {
                    voters = JSON.parse(voters);
                } catch (e) {
                    voters = [];
                }
            }

            if (voters.some(v => v.id === ctx.from.id)) {
                return ctx.answerCallbackQuery('⚠️ Hai già votato');
            }

            voters.push({ id: ctx.from.id, name: ctx.from.first_name, vote: voteType });

            const yesVotes = voters.filter(v => v.vote === 'yes').length;
            const noVotes = voters.filter(v => v.vote === 'no').length;

            await logic.updateVote(db, voteId, { voters, votes_yes: yesVotes, votes_no: noVotes });

            const config = await db.getGuildConfig(ctx.chat.id);

            // Check if majority reached
            if (yesVotes >= vote.required_votes) {
                await logic.updateVote(db, voteId, { status: 'completed' });

                // Extract action type from reason (saved as [DELETE] or [BAN] prefix)
                let actionType = 'ban'; // default
                if (vote.reason && vote.reason.startsWith('[DELETE]')) {
                    actionType = 'delete';
                } else if (vote.reason && vote.reason.startsWith('[BAN]')) {
                    actionType = 'ban';
                }
                const targetId = vote.target_user_id;

                if (actionType === 'ban') {
                    await safeBan(ctx, targetId, 'vote-ban');

                    // Forward to Parliament
                    if (superAdmin.forwardToParliament) {
                        await superAdmin.forwardToParliament({
                            type: 'voteban_completed',
                            user: { id: targetId, first_name: vote.target_username },
                            guildName: ctx.chat.title,
                            guildId: ctx.chat.id,
                            reason: vote.reason,
                            votes: `${yesVotes}/${vote.required_votes}`
                        });
                    }
                } else if (actionType === 'delete') {
                    // Delete the message the vote is replying to
                    const voteMsg = ctx.callbackQuery.message;
                    if (voteMsg && voteMsg.reply_to_message) {
                        try {
                            await ctx.api.deleteMessage(ctx.chat.id, voteMsg.reply_to_message.message_id);
                        } catch (e) {
                            logger.debug(`[report-system] Could not delete target message: ${e.message}`);
                        }
                    }
                }

                // Log
                logVoteResult(config, ctx.chat.id, actionType, targetId, vote.target_username, yesVotes, noVotes);

                const lang = await i18n.getLanguage(ctx.chat.id);
                const t = (key, params) => i18n.t(lang, key, params);
                const resultText =
                    actionType === 'ban'
                        ? t('report.result.banned', { user: vote.target_username, yes: yesVotes, no: noVotes })
                        : t('report.result.deleted', { user: vote.target_username, yes: yesVotes, no: noVotes });

                await ctx.editMessageText(resultText, { parse_mode: 'HTML' });
            } else if (noVotes > vote.required_votes / 2) {
                // Majority voted no
                await logic.updateVote(db, voteId, { status: 'rejected' });

                const lang = await i18n.getLanguage(ctx.chat.id);
                await ctx.editMessageText(i18n.t(lang, 'report.result.saved', { user: vote.target_username }), {
                    parse_mode: 'HTML'
                });
            } else {
                // Extract actionType from reason
                let updateActionType = 'ban';
                if (vote.reason && vote.reason.startsWith('[DELETE]')) {
                    updateActionType = 'delete';
                } else if (vote.reason && vote.reason.startsWith('[BAN]')) {
                    updateActionType = 'ban';
                }
                const { text, keyboard } = await ui.getVoteMessage(
                    ctx.chat.id,
                    { id: vote.target_user_id, username: vote.target_username },
                    null,
                    updateActionType,
                    yesVotes,
                    noVotes,
                    vote.required_votes,
                    vote.expires_at,
                    voteId
                );
                await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
            }

            await ctx.answerCallbackQuery();
            return;
        }

        await next();
    });
}

// Helper: Log vote result
function logVoteResult(config, guildId, actionType, targetId, targetName, yesVotes, noVotes) {
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

    const logKey = actionType === 'ban' ? 'vote_ban' : 'vote_delete';
    if (logEvents[logKey] && actionLog.getLogEvent && actionLog.getLogEvent()) {
        actionLog.getLogEvent()({
            guildId,
            eventType: logKey,
            targetUser: { id: targetId, first_name: targetName },
            reason: `VoteBan completed: ${yesVotes} yes, ${noVotes} no`,
            isGlobal: actionType === 'ban'
        });
    }
}

module.exports = {
    registerCommands
};
