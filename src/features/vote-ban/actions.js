const logic = require('./logic');
const ui = require('./ui');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');
const logger = require('../../middlewares/logger');

async function finalizeVote(ctx, db, vote, status, admin) {
    await logic.closeVote(db, vote.vote_id, status);

    // Prepare log details
    let details = '';
    try {
        const voters = JSON.parse(vote.voters || '[]');
        const fmt = v => `<a href="tg://user?id=${v.id}">${v.name}</a>`;
        const yes =
            voters
                .filter(v => typeof v === 'object' && v.vote === 'yes')
                .map(fmt)
                .join(', ') || 'Nessuno';
        const no =
            voters
                .filter(v => typeof v === 'object' && v.vote === 'no')
                .map(fmt)
                .join(', ') || 'Nessuno';
        details = `\n\n✅ Favorevoli: ${yes}\n🛡️ Contrari: ${no}`;
    } catch (e) { }

    if (status === 'passed' || status === 'forced_ban') {
        try {
            await ctx.editMessageText(
                `⚖️ **TRIBUNALE CHIUSO**\n\nL'utente @${vote.target_username} è stato BANNATO.\nEsito: ${status === 'forced_ban' ? 'Forzato da Admin' : 'Votazione Conclusa'}`,
                { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } }
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
            logger.error(`[vote-ban] Finalize vote error: ${e.message}`);
        }
    } else {
        await ctx.editMessageText(
            `⚖️ **TRIBUNALE CHIUSO**\n\nL'utente @${vote.target_username} è SALVO.\nEsito: ${status === 'pardon' ? 'Graziato da Admin' : 'Votazione Fallita'}`,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } }
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

    if (adminLogger.getLogEvent()) {
        let cause = 'Votazione Conclusa';
        if (status === 'forced_ban') cause = 'Forzato da Admin';
        else if (status === 'pardon') cause = 'Graziato da Admin';
        else if (status === 'failed') cause = 'Votazione Fallita';

        const cleanReason = vote.reason === 'Nessun motivo specificato' ? '' : ` - ${vote.reason}`;

        // Ensure title is available. usage of ctx.chat.title assumes finalizeVote is called with full context.
        // If called from cleanup, ctx might be missing or different.
        // Adjust for that in processExpiredVotes.

        adminLogger.getLogEvent()({
            guildId: vote.chat_id,
            guildName: ctx.chat.title || 'Unknown Group',
            eventType: 'vote_ban',
            customTags: tags,
            targetUser: { id: vote.target_user_id, username: vote.target_username, first_name: vote.target_username },
            executorAdmin: admin,
            reason: `Esito: ${cause}${cleanReason}${details}`,
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

            // Prepare details for log and message
            let details = '';
            try {
                const voters = JSON.parse(vote.voters || '[]');
                const fmt = v => `<a href="tg://user?id=${v.id}">${v.name}</a>`;
                const yes =
                    voters
                        .filter(v => typeof v === 'object' && v.vote === 'yes')
                        .map(fmt)
                        .join(', ') || 'Nessuno';
                const no =
                    voters
                        .filter(v => typeof v === 'object' && v.vote === 'no')
                        .map(fmt)
                        .join(', ') || 'Nessuno';
                details = `\n\n✅ Favorevoli: ${yes}\n🛡️ Contrari: ${no}`;
            } catch (e) { }

            // Get Guild Name manually since we don't have ctx
            let guildName = 'Unknown Group';
            try {
                const chat = await bot.api.getChat(vote.chat_id);
                guildName = chat.title;
            } catch (e) { }

            // Log outcome
            if (adminLogger.getLogEvent()) {
                const cleanReason = vote.reason === 'Nessun motivo specificato' ? '' : ` - ${vote.reason}`;

                adminLogger.getLogEvent()({
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
                    reason: `Esito: Scaduto (Voti Insufficienti)${cleanReason}${details}`,
                    isGlobal: true
                });
            }

            try {
                await bot.api.editMessageText(
                    vote.chat_id,
                    vote.poll_message_id,
                    `⚖️ **TRIBUNALE CHIUSO**\n\nL'utente @${vote.target_username} è SALVO (Scaduto).\nEsito: Votazione Scaduta`,
                    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } }
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
                parse_mode: 'Markdown'
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
