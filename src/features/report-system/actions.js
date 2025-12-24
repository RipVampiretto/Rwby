const logic = require('./logic');
const ui = require('./ui');
const actionLog = require('../action-log');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');
const logger = require('../../middlewares/logger');
const i18n = require('../../i18n');

async function finalizeVote(ctx, db, vote, status, admin) {
    await logic.closeVote(db, vote.vote_id, status);

    // Get guild language
    const lang = await i18n.getLanguage(vote.chat_id);
    const t = (key, p) => i18n.t(lang, key, p);

    // Prepare log details
    let details = '';
    try {
        const voters = JSON.parse(vote.voters || '[]');
        const fmt = v => `<a href="tg://user?id=${v.id}">${v.name}</a>`;
        const yes =
            voters
                .filter(v => typeof v === 'object' && v.vote === 'yes')
                .map(fmt)
                .join(', ') || t('voteban.log.nobody');
        const no =
            voters
                .filter(v => typeof v === 'object' && v.vote === 'no')
                .map(fmt)
                .join(', ') || t('voteban.log.nobody');
        details = `\n\n✅ ${t('voteban.log.in_favor')}: ${yes}\n🛡️ ${t('voteban.log.against')}: ${no}`;
    } catch (e) { }

    if (status === 'passed' || status === 'forced_ban') {
        try {
            const outcome =
                status === 'forced_ban' ? t('voteban.log.forced_by_admin') : t('voteban.log.vote_concluded');
            await ctx.editMessageText(
                `⚖️ **${t('voteban.log.tribunal_closed')}**\n\n${t('voteban.log.user_banned', { user: vote.target_username })}\n${t('voteban.log.outcome')}: ${outcome}`,
                { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }
            );

            // Delete after 1 minute
            setTimeout(() => {
                try {
                    ctx.deleteMessage().catch(() => { });
                } catch (e) { }
            }, 60000);

            await ctx.banChatMember(vote.target_user_id);
            userReputation.modifyFlux(vote.target_user_id, vote.chat_id, -200, 'vote_ban');

            if (superAdmin.forwardBanToParliament) {
                superAdmin.forwardBanToParliament({
                    user: { id: vote.target_user_id, username: vote.target_username },
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: `Vote Ban: ${vote.reason}`,
                    evidence: `Votes: ${vote.votes_yes} Yes / ${vote.votes_no} No${details}`,
                    flux: userReputation.getLocalFlux(vote.target_user_id, vote.chat_id)
                });
            }
        } catch (e) {
            logger.error(`[report-system] Finalize vote error: ${e.message}`);
        }
    } else {
        const outcome = status === 'pardon' ? t('voteban.log.pardoned_by_admin') : t('voteban.log.vote_failed');
        await ctx.editMessageText(
            `⚖️ **${t('voteban.log.tribunal_closed')}**\n\n${t('voteban.log.user_saved', { user: vote.target_username })}\n${t('voteban.log.outcome')}: ${outcome}`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }
        );

        // Delete after 1 minute
        setTimeout(() => {
            try {
                ctx.deleteMessage().catch(() => { });
            } catch (e) { }
        }, 60000);
    }

    const tags = ['#VOTE_BAN'];
    if (status === 'passed' || status === 'forced_ban') tags.push('#BAN');
    else tags.push('#SAVE');

    if (actionLog.getLogEvent()) {
        let cause = t('voteban.log.vote_concluded');
        if (status === 'forced_ban') cause = t('voteban.log.forced_by_admin');
        else if (status === 'pardon') cause = t('voteban.log.pardoned_by_admin');
        else if (status === 'failed') cause = t('voteban.log.vote_failed');

        const noReasonText = t('voteban.log.no_reason');
        const noReasonTextIT = i18n.t('it', 'report.no_reason'); // Handle legacy Italian entries
        const cleanReason =
            vote.reason === noReasonText || vote.reason === noReasonTextIT ? '' : ` - ${vote.reason}`;

        actionLog.getLogEvent()({
            guildId: vote.chat_id,
            guildName: ctx.chat.title || 'Unknown Group',
            eventType: 'vote_ban',
            customTags: tags,
            targetUser: { id: vote.target_user_id, username: vote.target_username, first_name: vote.target_username },
            executorAdmin: admin,
            reason: `${t('voteban.log.outcome')}: ${cause}${cleanReason}${details}`,
            isGlobal: true
        });
    }
}

async function processExpiredVotes(bot, db) {
    const now = new Date();
    // Get all active votes directly via logic (ASYNC!)
    const votes = await logic.getAllActiveVotes(db);
    if (!votes || !Array.isArray(votes)) return;

    for (const vote of votes) {
        // Check expire
        const expires = new Date(vote.expires_at);
        if (expires < now) {
            await logic.closeVote(db, vote.vote_id, 'expired');

            // Get guild language
            const lang = await i18n.getLanguage(vote.chat_id);
            const t = (key, p) => i18n.t(lang, key, p);

            // Prepare details for log and message
            let details = '';
            try {
                const voters = JSON.parse(vote.voters || '[]');
                const fmt = v => `<a href="tg://user?id=${v.id}">${v.name}</a>`;
                const yes =
                    voters
                        .filter(v => typeof v === 'object' && v.vote === 'yes')
                        .map(fmt)
                        .join(', ') || t('voteban.log.nobody');
                const no =
                    voters
                        .filter(v => typeof v === 'object' && v.vote === 'no')
                        .map(fmt)
                        .join(', ') || t('voteban.log.nobody');
                details = `\n\n✅ ${t('voteban.log.in_favor')}: ${yes}\n🛡️ ${t('voteban.log.against')}: ${no}`;
            } catch (e) { }

            // Get Guild Name manually since we don't have ctx
            let guildName = 'Unknown Group';
            try {
                const chat = await bot.api.getChat(vote.chat_id);
                guildName = chat.title;
            } catch (e) { }

            // Log outcome
            if (actionLog.getLogEvent()) {
                const noReasonText = t('voteban.log.no_reason');
                const noReasonTextIT = i18n.t('it', 'report.no_reason'); // Handle legacy Italian entries
                const cleanReason =
                    vote.reason === noReasonText || vote.reason === noReasonTextIT
                        ? ''
                        : ` - ${vote.reason}`;

                actionLog.getLogEvent()({
                    guildId: vote.chat_id,
                    guildName: guildName,
                    eventType: 'vote_ban',
                    customTags: ['#VOTE_BAN', '#EXPIRED'],
                    targetUser: {
                        id: vote.target_user_id,
                        username: vote.target_username,
                        first_name: vote.target_username
                    },
                    executorAdmin: { first_name: 'System (Expired)' },
                    reason: `${t('voteban.log.outcome')}: ${t('voteban.log.expired')}${cleanReason}${details}`,
                    isGlobal: true
                });
            }

            try {
                await bot.api.editMessageText(
                    vote.chat_id,
                    vote.poll_message_id,
                    `⚖️ **${t('voteban.log.tribunal_closed')}**\n\n${t('voteban.log.user_saved_expired', { user: vote.target_username })}\n${t('voteban.log.outcome')}: ${t('voteban.log.expired')}`,
                    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }
                );
                // Delete after 1 minute
                setTimeout(() => {
                    try {
                        bot.api.deleteMessage(vote.chat_id, vote.poll_message_id).catch(() => { });
                    } catch (e) { }
                }, 60000);
            } catch (e) { }
            continue;
        }

        // Update Timer UI if not expired
        try {
            const { text, keyboard } = await ui.getVoteMessage(
                vote.guild_id,
                { id: vote.target_user_id, username: vote.target_username },
                null,
                vote.reason,
                vote.votes_yes,
                vote.votes_no,
                vote.required_votes,
                vote.expires_at,
                vote.vote_id,
                false
            );
            await bot.api.editMessageText(vote.chat_id, vote.poll_message_id, text, {
                reply_markup: keyboard,
                parse_mode: 'HTML'
            });
        } catch (e) {
            // "message is not modified"
        }
    }
}

module.exports = {
    finalizeVote,
    processExpiredVotes
};
