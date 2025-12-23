const logic = require('./logic');
const actions = require('./actions');
const ui = require('./ui');
const { safeDelete, safeBan } = require('../../utils/error-handlers');
const smartReport = require('./analysis-utils');
const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
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
        } catch (e) { }
        logger.info(`[vote-ban] Confirmation timeout for ${target.id}`);
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
        const votebanEnabled = config.voteban_enabled;

        if (!votebanEnabled) return next();

        // Must reply to a message
        if (!ctx.message.reply_to_message) {
            const lang = await i18n.getLanguage(ctx.chat.id);
            return ctx.reply(i18n.t(lang, 'voteban.errors.reply_required'));
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
        } catch (e) { }

        // Check for existing vote
        const existing = await logic.getActiveVoteForUser(db, ctx.chat.id, target.id);
        if (existing) {
            const lang = await i18n.getLanguage(ctx.chat.id);
            return ctx.reply(i18n.t(lang, 'voteban.errors.already_active'), {
                reply_to_message_id: existing.poll_message_id
            });
        }

        const lang = await i18n.getLanguage(ctx.chat.id);
        const reason = text.replace(/^[@!./]admin\s*/i, '').trim() || i18n.t(lang, 'voteban.no_reason');

        // Check report mode
        const reportMode = config.report_mode || 'ai_voteban';

        // -- MODE: voteban_only (skip AI) --
        if (reportMode === 'voteban_only') {
            logger.info(`[smart-report] VoteBan only mode - showing confirmation`);
            const confirmMsg = await ui.sendConfirmationPrompt(ctx, target, targetMsg.message_id);
            setupConfirmationTimeout(ctx, target, confirmMsg, reason);
            return;
        }

        // -- AI ANALYSIS (ai_only or ai_voteban) --
        logger.info(`[smart-report] Analyzing report with AI...`);
        const analysisResult = await smartReport.analyzeTarget(ctx, config);

        if (analysisResult.isViolation) {
            // AI found a violation - execute action based on category
            logger.info(`[smart-report] Violation: ${analysisResult.category}`);

            const action = analysisResult.action || 'report_only';
            const t = (key, params) => i18n.t(lang, key, params);

            if (action === 'delete') {
                await safeDelete({ message: targetMsg, api: ctx.api, chat: ctx.chat }, 'smart-report');

                // Warning message (auto-delete 1 min)
                const userName = target.username ? `@${target.username}` : target.first_name;
                const notifyMsg = await ctx.reply(
                    t('smart_report.action_delete', { category: analysisResult.category, user: userName }),
                    { parse_mode: 'Markdown' }
                );
                setTimeout(async () => {
                    try { await ctx.api.deleteMessage(ctx.chat.id, notifyMsg.message_id); } catch (e) { }
                }, 60000);

                // Log
                logAction(config, ctx.chat.id, 'vote_delete', target, ctx.from, analysisResult);

            } else if (action === 'ban') {
                await safeDelete({ message: targetMsg, api: ctx.api, chat: ctx.chat }, 'smart-report');
                await safeBan(ctx, target.id, 'smart-report');

                // Forward to Parliament
                if (superAdmin.forwardToParliament) {
                    await superAdmin.forwardToParliament({
                        type: 'smart_report_ban',
                        user: target,
                        guildName: ctx.chat.title,
                        guildId: ctx.chat.id,
                        reason: `[${analysisResult.category}] ${analysisResult.reason}`,
                        evidence: targetMsg.text || targetMsg.caption || '[Media]'
                    });
                }

                // Warning message
                const userName = target.username ? `@${target.username}` : target.first_name;
                const notifyMsg = await ctx.reply(
                    t('smart_report.action_ban', { category: analysisResult.category, user: userName }),
                    { parse_mode: 'Markdown' }
                );
                setTimeout(async () => {
                    try { await ctx.api.deleteMessage(ctx.chat.id, notifyMsg.message_id); } catch (e) { }
                }, 60000);

                // Log
                logAction(config, ctx.chat.id, 'vote_ban', target, ctx.from, analysisResult);

            } else {
                // report_only
                await staffCoordination.reviewQueue({
                    guildId: ctx.chat.id,
                    source: 'Smart-Report',
                    user: target,
                    reason: `[AI: ${analysisResult.category}] ${analysisResult.reason}`,
                    messageId: targetMsg.message_id,
                    content: targetMsg.text || targetMsg.caption || '[Media]'
                });

                const notifyMsg = await ctx.reply(t('smart_report.action_report', { category: analysisResult.category }), { parse_mode: 'Markdown' });
                setTimeout(async () => {
                    try { await ctx.api.deleteMessage(ctx.chat.id, notifyMsg.message_id); } catch (e) { }
                }, 60000);
            }

            return;
        }

        // AI says SAFE
        logger.info(`[smart-report] AI says safe.`);

        // -- MODE: ai_only (no voteban fallback) --
        if (reportMode === 'ai_only') {
            // Send to staff for manual review
            await staffCoordination.reviewQueue({
                guildId: ctx.chat.id,
                source: 'Smart-Report',
                user: target,
                reason: `[Manual Review] ${reason}`,
                messageId: targetMsg.message_id,
                content: targetMsg.text || targetMsg.caption || '[Media]'
            });

            const t = (key, params) => i18n.t(lang, key, params);
            const notifyMsg = await ctx.reply(t('voteban.log.report_sent_to_staff'), { parse_mode: 'Markdown' });
            setTimeout(async () => {
                try { await ctx.api.deleteMessage(ctx.chat.id, notifyMsg.message_id); } catch (e) { }
            }, 60000);
            return;
        }

        // -- MODE: ai_voteban (fallback to VoteBan) --
        logger.info(`[smart-report] AI says safe - showing VoteBan confirmation`);
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
                return ctx.answerCallbackQuery(i18n.t(lang, 'voteban.errors.not_initiator'));
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
            const duration = config.voteban_duration_minutes || 30;
            const required = config.voteban_threshold || 5;
            const expires = duration === 0
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
                1, 0, required,
                expires,
                voteId
            );

            // Delete confirmation message and send vote as reply to the reported message
            await ctx.deleteMessage();
            const voteMsg = await ctx.api.sendMessage(ctx.chat.id, msgText, {
                reply_markup: keyboard,
                parse_mode: 'Markdown',
                reply_to_message_id: pending.targetMsgId
            });
            await logic.setPollMessageId(db, voteId, voteMsg.message_id);
            await ctx.answerCallbackQuery();
            return;
        }

        // Config Handlers
        if (data.startsWith('vb_')) {
            const config = await db.getGuildConfig(ctx.chat.id);

            if (data === 'vb_toggle') {
                await db.updateGuildConfig(ctx.chat.id, { voteban_enabled: config.voteban_enabled ? 0 : 1 });
            } else if (data === 'vb_thr') {
                const val = config.voteban_threshold || 5;
                const thresholds = [3, 5, 7, 10];
                const idx = thresholds.indexOf(val);
                const nextVal = thresholds[(idx + 1) % thresholds.length];
                await db.updateGuildConfig(ctx.chat.id, { voteban_threshold: nextVal });
            } else if (data === 'vb_dur') {
                const val = config.voteban_duration_minutes;
                const durations = [15, 30, 60, 0];
                const idx = durations.indexOf(val);
                const nextVal = durations[(idx + 1) % durations.length];
                await db.updateGuildConfig(ctx.chat.id, { voteban_duration_minutes: nextVal });
            } else if (data.startsWith('vb_cat_')) {
                const cat = data.replace('vb_cat_', '');
                const key = `report_action_${cat}`;
                const current = config[key] || 'report_only';
                const actions = ['report_only', 'delete', 'ban'];
                const idx = actions.indexOf(current);
                const nextVal = actions[(idx + 1) % actions.length];
                await db.updateGuildConfig(ctx.chat.id, { [key]: nextVal });
            } else if (data === 'vb_mode') {
                const val = config.report_mode || 'ai_voteban';
                const modes = ['ai_only', 'voteban_only', 'ai_voteban'];
                const idx = modes.indexOf(val);
                const nextVal = modes[(idx + 1) % modes.length];
                await db.updateGuildConfig(ctx.chat.id, { report_mode: nextVal });
            } else if (data === 'vb_log_ban' || data === 'vb_log_delete') {
                const logType = data === 'vb_log_ban' ? 'vote_ban' : 'vote_delete';
                let logEvents = {};
                if (config.log_events) {
                    if (typeof config.log_events === 'string') {
                        try { logEvents = JSON.parse(config.log_events); } catch (e) { }
                    } else if (typeof config.log_events === 'object') {
                        logEvents = config.log_events;
                    }
                }
                logEvents[logType] = !logEvents[logType];
                await db.updateGuildConfig(ctx.chat.id, { log_events: logEvents });
            } else if (data === 'vb_categories') {
                await ui.sendCategoryActionsUI(ctx, db, true);
                return;
            } else if (data === 'vb_back_main') {
                await ui.sendConfigUI(ctx, db, true);
                return;
            }

            // Update config UI for category changes
            if (data.startsWith('vb_cat_')) {
                await ui.sendCategoryActionsUI(ctx, db, true);
                return;
            }

            await ui.sendConfigUI(ctx, db, true);
            return;
        }

        // Vote handlers
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
                try { voters = JSON.parse(voters); } catch (e) { voters = []; }
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

                const actionType = vote.action_type || 'ban';
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
                }

                // Log
                logVoteResult(config, ctx.chat.id, actionType, targetId, vote.target_username, yesVotes, noVotes);

                const lang = await i18n.getLanguage(ctx.chat.id);
                const t = (key, params) => i18n.t(lang, key, params);
                const resultText = actionType === 'ban'
                    ? t('voteban.result.banned', { user: vote.target_username, yes: yesVotes, no: noVotes })
                    : t('voteban.result.deleted', { user: vote.target_username, yes: yesVotes, no: noVotes });

                await ctx.editMessageText(resultText, { parse_mode: 'Markdown' });
            } else if (noVotes > vote.required_votes / 2) {
                // Majority voted no
                await logic.updateVote(db, voteId, { status: 'rejected' });

                const lang = await i18n.getLanguage(ctx.chat.id);
                await ctx.editMessageText(i18n.t(lang, 'voteban.result.saved', { user: vote.target_username }), { parse_mode: 'Markdown' });
            } else {
                // Update vote message
                const { text, keyboard } = await ui.getVoteMessage(
                    ctx.chat.id,
                    { id: vote.target_user_id, username: vote.target_username },
                    null,
                    vote.action_type || 'ban',
                    yesVotes, noVotes, vote.required_votes,
                    vote.expires_at,
                    voteId
                );
                await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
            }

            await ctx.answerCallbackQuery();
            return;
        }

        await next();
    });
}

// Helper: Log action to admin logger
function logAction(config, guildId, eventType, targetUser, executor, analysisResult) {
    let logEvents = {};
    if (config.log_events) {
        if (typeof config.log_events === 'string') {
            try { logEvents = JSON.parse(config.log_events); } catch (e) { }
        } else if (typeof config.log_events === 'object') {
            logEvents = config.log_events;
        }
    }

    if (logEvents[eventType] && adminLogger.getLogEvent()) {
        adminLogger.getLogEvent()({
            guildId,
            eventType,
            targetUser,
            executorAdmin: executor,
            reason: analysisResult ? `[${analysisResult.category}] ${analysisResult.reason}` : 'VoteBan',
            isGlobal: eventType === 'vote_ban'
        });
    }
}

// Helper: Log vote result
function logVoteResult(config, guildId, actionType, targetId, targetName, yesVotes, noVotes) {
    let logEvents = {};
    if (config.log_events) {
        if (typeof config.log_events === 'string') {
            try { logEvents = JSON.parse(config.log_events); } catch (e) { }
        } else if (typeof config.log_events === 'object') {
            logEvents = config.log_events;
        }
    }

    const logKey = actionType === 'ban' ? 'vote_ban' : 'vote_delete';
    if (logEvents[logKey] && adminLogger.getLogEvent()) {
        adminLogger.getLogEvent()({
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
