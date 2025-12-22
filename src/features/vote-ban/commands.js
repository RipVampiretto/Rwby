const logic = require('./logic');
const actions = require('./actions');
const ui = require('./ui');
const { isAdmin, isFromSettingsMenu, safeDelete, safeBan } = require('../../utils/error-handlers');
const smartReport = require('./analysis-utils');
const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const logger = require('../../middlewares/logger');

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

        // Check report mode
        const reportMode = config.report_mode || 'ai_voteban';
        const votebanEnabled = config.voteban_enabled;

        // If VoteBan-only mode and voteban is disabled, skip
        if (reportMode === 'voteban_only' && !votebanEnabled) return;

        // Get reason from the trigger message
        const reason = text.replace(/^[@!./]admin\s*/i, '').trim() || 'Nessun motivo specificato';

        // =====================================================================
        // REPLY MODE: User replied to a specific message
        // =====================================================================
        if (ctx.message.reply_to_message) {
            const targetMsg = ctx.message.reply_to_message;
            const target = targetMsg.from;

            if (target.is_bot) return ctx.reply('❌ Non puoi segnalare i bot.');
            if (target.id === ctx.from.id) return ctx.reply('❌ Non puoi segnalare te stesso.');

            // Check admin bypass
            try {
                const member = await ctx.getChatMember(target.id);
                if (['creator', 'administrator'].includes(member.status)) {
                    return;
                }
            } catch (e) { }

            // Check initiator tier requirement
            const reqTier = config.voteban_initiator_tier !== undefined ? config.voteban_initiator_tier : 0;
            if (reqTier !== -1 && ctx.userTier < reqTier) {
                return ctx.reply(`❌ Devi essere almeno T${reqTier} per segnalare.`);
            }

            // Check for existing vote
            const existing = await logic.getActiveVoteForUser(db, ctx.chat.id, target.id);
            if (existing) {
                return ctx.reply("⚠️ C'è già una votazione attiva per questo utente.", {
                    reply_to_message_id: existing.poll_message_id
                });
            }

            // ------------------------------------------------------
            // AI ANALYSIS (if enabled in report_mode)
            // ------------------------------------------------------
            if (reportMode === 'ai_only' || reportMode === 'ai_voteban') {
                logger.info(`[smart-report] Analyzing report in reply mode...`);
                const analysisResult = await smartReport.analyzeTarget(ctx, config);

                if (analysisResult.isViolation) {
                    // AI found a violation - execute action
                    logger.info(
                        `[smart-report] Violation detected: ${analysisResult.category} - ${analysisResult.reason}`
                    );

                    const action = analysisResult.action || 'delete';
                    const i18n = require('../../i18n');
                    const lang = await i18n.getLanguage(ctx.chat.id);
                    const t = (key, params) => i18n.t(lang, key, params);
                    const userReputation = require('../user-reputation');

                    // Delete the offending message first
                    await safeDelete({ message: targetMsg, api: ctx.api, chat: ctx.chat }, 'smart-report');

                    if (action === 'delete') {
                        // Send pretty notification (will auto-delete)
                        const notifyMsg = await ctx.reply(
                            t('smart_report.action_delete', { category: analysisResult.category }),
                            { parse_mode: 'Markdown' }
                        );
                        // Auto-delete after 1 minute
                        setTimeout(async () => {
                            try {
                                await ctx.api.deleteMessage(ctx.chat.id, notifyMsg.message_id);
                            } catch (e) { }
                        }, 60000);
                    } else if (action === 'ban') {
                        // Ban the user
                        await safeBan(ctx, target.id, 'smart-report');

                        // Award Flux to reporter (+2)
                        try {
                            await userReputation.modifyFlux(ctx.from.id, ctx.chat.id, 2, 'smart_report_valid');
                        } catch (e) {
                            logger.warn(`[smart-report] Failed to award Flux: ${e.message}`);
                        }

                        // Add Like reaction to the report message
                        try {
                            await ctx.api.setMessageReaction(ctx.chat.id, ctx.message.message_id, [
                                { type: 'emoji', emoji: '👍' }
                            ]);
                        } catch (e) {
                            logger.debug(`[smart-report] Failed to add reaction: ${e.message}`);
                        }

                        // Send pretty notification (will auto-delete)
                        const notifyMsg = await ctx.reply(
                            t('smart_report.action_ban', {
                                category: analysisResult.category,
                                user: target.first_name || target.username || target.id
                            }),
                            { parse_mode: 'Markdown' }
                        );
                        // Auto-delete after 1 minute
                        setTimeout(async () => {
                            try {
                                await ctx.api.deleteMessage(ctx.chat.id, notifyMsg.message_id);
                            } catch (e) { }
                        }, 60000);

                        // Log to admin channel
                        if (adminLogger.getLogEvent()) {
                            adminLogger.getLogEvent()({
                                guildId: ctx.chat.id,
                                eventType: 'smart_report_ban',
                                targetUser: target,
                                executedBy: ctx.from,
                                reason: `[${analysisResult.category}] ${analysisResult.reason}`,
                                isGlobal: true
                            });
                        }
                    } else {
                        // report_only - send to staff
                        staffCoordination.reviewQueue({
                            guildId: ctx.chat.id,
                            source: 'Smart-Report',
                            user: target,
                            reason: `[AI] ${analysisResult.category}: ${analysisResult.reason}`,
                            messageId: targetMsg.message_id,
                            content: targetMsg.text || targetMsg.caption || '[Media]'
                        });
                        const notifyMsg = await ctx.reply(
                            t('smart_report.action_report', { category: analysisResult.category }),
                            { parse_mode: 'Markdown' }
                        );
                        // Auto-delete after 1 minute
                        setTimeout(async () => {
                            try {
                                await ctx.api.deleteMessage(ctx.chat.id, notifyMsg.message_id);
                            } catch (e) { }
                        }, 60000);
                    }

                    return; // Done - AI handled it
                }

                // AI says SAFE - check fallback behavior
                if (reportMode === 'ai_only') {
                    // AI Only mode - send to staff if safe
                    staffCoordination.reviewQueue({
                        guildId: ctx.chat.id,
                        source: 'Smart-Report',
                        user: target,
                        reason: `[Manual] ${reason}`,
                        messageId: targetMsg.message_id,
                        content: targetMsg.text || targetMsg.caption || '[Media]'
                    });
                    return ctx.reply(
                        `📋 **Report Inviato**\nL'AI non ha rilevato violazioni automatiche.\nLo staff esaminerà la segnalazione.`,
                        { parse_mode: 'Markdown' }
                    );
                }

                // AI + VoteBan mode: AI says safe, proceed to VoteBan
                logger.info(`[smart-report] AI says safe, proceeding to VoteBan...`);
            }

            // ------------------------------------------------------
            // VOTEBAN (fallback or primary if voteban_only)
            // ------------------------------------------------------
            if (!votebanEnabled) {
                // VoteBan not enabled, just send to staff
                staffCoordination.reviewQueue({
                    guildId: ctx.chat.id,
                    source: 'Smart-Report',
                    user: target,
                    reason: reason,
                    messageId: targetMsg.message_id,
                    content: targetMsg.text || targetMsg.caption || '[Media]'
                });
                return ctx.reply(`📋 **Report Inviato**\nSegnalazione inviata allo staff.`, { parse_mode: 'Markdown' });
            }

            const duration = config.voteban_duration_minutes || 30;
            const required = config.voteban_threshold || 5;
            const expires =
                duration === 0
                    ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
                    : new Date(Date.now() + duration * 60000).toISOString();

            const voters = [{ id: ctx.from.id, name: ctx.from.first_name, vote: 'yes' }];

            const voteId = await logic.createVote(db, {
                target,
                chat: ctx.chat,
                initiator: ctx.from,
                reason,
                required,
                expires,
                voters
            });

            const { text: msgText, keyboard } = await ui.getVoteMessage(
                ctx.chat.id,
                target,
                ctx.from,
                reason,
                1,
                0,
                required,
                expires,
                voteId,
                duration === 0
            );
            const msg = await ctx.reply(msgText, { reply_markup: keyboard, parse_mode: 'Markdown' });

            await logic.setPollMessageId(db, voteId, msg.message_id);
            return;
        }

        // =====================================================================
        // CONTEXT MODE: No reply - analyze last N messages
        // =====================================================================
        // Context mode only works with AI modes (not voteban_only)
        if (reportMode === 'voteban_only') {
            return ctx.reply("⚖️ Rispondi al messaggio dell'utente che vuoi segnalare.");
        }

        const numContext = 10; // Fixed at 10 messages
        logger.info(`[smart-report] Context mode: analyzing last ${numContext} messages`);

        const analysisResults = await smartReport.analyzeContextMessages(ctx, config, numContext);
        const violations = analysisResults.filter(r => r.isViolation);

        if (violations.length === 0) {
            // No violations found - REPORT_ONLY (forced in context mode when no violations)
            staffCoordination.reviewQueue({
                guildId: ctx.chat.id,
                source: 'Smart-Report',
                user: ctx.from,
                reason: `[Context Scan] ${reason}`,
                messageId: ctx.message.message_id,
                content: `Scansione ultimi ${numContext} messaggi: Nessuna violazione rilevata`
            });
            return ctx.reply(
                `📋 **Context Scan**\nAnalizzati ${analysisResults.length} messaggi.\nNessuna violazione rilevata.\n\n_Segnalazione inviata allo staff per revisione manuale._`,
                { parse_mode: 'Markdown' }
            );
        }

        // Found violations - handle each one
        let deletedCount = 0;
        for (const result of violations) {
            try {
                await ctx.api.deleteMessage(ctx.chat.id, result.messageId);
                deletedCount++;
            } catch (e) {
                logger.warn(`[smart-report] Failed to delete message ${result.messageId}: ${e.message}`);
            }
        }

        await ctx.reply(
            `🤖 **AI Context Scan**\nAnalizzati: ${analysisResults.length} messaggi\nViolazioni: ${violations.length}\nEliminati: ${deletedCount}\n\nCategorie: ${violations.map(v => v.category).join(', ')}`,
            { parse_mode: 'Markdown' }
        );
    });

    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;

        // Config Handlers
        if (data.startsWith('vb_')) {
            const config = await db.getGuildConfig(ctx.chat.id);
            const fromSettings = isFromSettingsMenu(ctx);

            if (data === 'vb_close') return ctx.deleteMessage();

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
            } else if (data === 'vb_tier') {
                const val = config.voteban_initiator_tier || 0;
                const tiers = [0, 1, 2, 3, -1];
                const idx = tiers.indexOf(val);
                const nextVal = tiers[(idx + 1) % tiers.length];
                await db.updateGuildConfig(ctx.chat.id, { voteban_initiator_tier: nextVal });
            } else if (data === 'vb_mode') {
                // Cycle through report modes: voteban_only -> ai_only -> ai_voteban
                const val = config.report_mode || 'ai_voteban';
                const modes = ['voteban_only', 'ai_only', 'ai_voteban'];
                const idx = modes.indexOf(val);
                const nextVal = modes[(idx + 1) % modes.length];
                await db.updateGuildConfig(ctx.chat.id, { report_mode: nextVal });
            } else if (data === 'vb_ctx') {
                // Cycle through context message counts: 5 -> 10 -> 15 -> 20
                const val = config.report_context_messages || 10;
                const counts = [5, 10, 15, 20];
                const idx = counts.indexOf(val);
                const nextVal = counts[(idx + 1) % counts.length];
                await db.updateGuildConfig(ctx.chat.id, { report_context_messages: nextVal });
            } else if (data === 'vb_cat_actions') {
                // Open category actions UI
                await ui.sendCategoryActionsUI(ctx, db, true);
                return;
            } else if (data === 'vb_back_main') {
                // Back to main report UI from category actions - always show Back since we came from settings
                await ui.sendConfigUI(ctx, db, true, true);
                return;
            }
            await ui.sendConfigUI(ctx, db, true, fromSettings);
            return;
        }

        // Smart Report Category Action Handlers
        if (data.startsWith('report_cat_')) {
            const cat = data.replace('report_cat_', '');
            const config = await db.getGuildConfig(ctx.chat.id);
            const key = `report_action_${cat}`;
            const current = config[key] || 'report_only';

            // Cycle: report_only -> delete -> ban -> report_only
            const actions = ['report_only', 'delete', 'ban'];
            const idx = actions.indexOf(current);
            const nextVal = actions[(idx + 1) % actions.length];

            await db.updateGuildConfig(ctx.chat.id, { [key]: nextVal });
            await ui.sendCategoryActionsUI(ctx, db, true);
            return;
        }

        // Vote Action Handlers
        if (data.startsWith('vote_')) {
            const parts = data.split('_');
            const action = parts[1];
            const voteId = parseInt(parts[2]);

            if (isNaN(voteId)) return ctx.answerCallbackQuery('Errore: ID votazione non valido.');

            const vote = await logic.getVote(db, voteId);
            if (!vote || vote.status !== 'active') return ctx.answerCallbackQuery('Votazione scaduta o inesistente.');

            const member = await ctx.getChatMember(ctx.from.id);
            const isAdmin = ['creator', 'administrator'].includes(member.status);

            // Admin Logic
            if (isAdmin) {
                if (action === 'yes' || action === 'ban') {
                    await actions.finalizeVote(ctx, db, vote, 'forced_ban', ctx.from);
                    return;
                }
                if (action === 'no' || action === 'pardon') {
                    await actions.finalizeVote(ctx, db, vote, 'pardon', ctx.from);
                    return;
                }
            }

            // Voting Logic
            const config = await db.getGuildConfig(ctx.chat.id);
            if (ctx.userTier < (config.voteban_voter_tier || 0)) {
                return ctx.answerCallbackQuery('Tier insufficiente per votare.');
            }

            let voters = [];
            try {
                voters = JSON.parse(vote.voters || '[]');
            } catch (e) { }

            const hasVoted = voters.some(v => (typeof v === 'object' ? v.id : v) === ctx.from.id);
            if (hasVoted) return ctx.answerCallbackQuery('Hai già votato!');

            voters.push({ id: ctx.from.id, name: ctx.from.first_name, vote: action });
            let yes = vote.votes_yes;
            let no = vote.votes_no;

            if (action === 'yes') yes++;
            else if (action === 'no') no++;

            await logic.updateVote(db, voteId, yes, no, voters);

            await ctx.answerCallbackQuery('Voto registrato.');

            if (yes + no >= vote.required_votes) {
                vote.votes_yes = yes;
                vote.votes_no = no;
                vote.voters = JSON.stringify(voters);

                const outcome = yes > no ? 'passed' : 'failed';
                await actions.finalizeVote(ctx, db, vote, outcome, null);
            } else {
                const { text, keyboard } = await ui.getVoteMessage(
                    vote.guild_id,
                    { id: vote.target_user_id, username: vote.target_username },
                    { id: vote.initiated_by, username: '...' },
                    vote.reason,
                    yes,
                    no,
                    vote.required_votes,
                    vote.expires_at,
                    voteId,
                    false
                );
                try {
                    await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
                } catch (e) { }
            }
        }

        await next();
    });
}

module.exports = {
    registerCommands
};
