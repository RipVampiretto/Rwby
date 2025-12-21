const logic = require('./logic');
const actions = require('./actions');
const ui = require('./ui');
const { isAdmin, isFromSettingsMenu } = require('../../utils/error-handlers');

function registerCommands(bot, db) {
    // Trigger: @admin, etc.
    bot.on('message:text', async (ctx, next) => {
        const text = ctx.message.text.toLowerCase().trim();
        const triggers = ['@admin', '!admin', '.admin', '/admin'];

        if (!triggers.some(t => text.startsWith(t))) {
            return next();
        }

        if (ctx.chat.type === 'private') return next();

        if (!ctx.message.reply_to_message) {
            return ctx.reply("⚖️ Rispondi al messaggio dell'utente che vuoi segnalare.");
        }

        const target = ctx.message.reply_to_message.from;
        if (target.is_bot) return ctx.reply("❌ Non puoi segnalare i bot.");
        if (target.id === ctx.from.id) return ctx.reply("❌ Non puoi segnalare te stesso.");

        const config = db.getGuildConfig(ctx.chat.id);
        if (!config.voteban_enabled) return;

        const reqTier = config.voteban_initiator_tier !== undefined ? config.voteban_initiator_tier : 0;
        if (reqTier !== -1 && ctx.userTier < reqTier) {
            return ctx.reply(`❌ Devi essere almeno T${reqTier} per segnalare.`);
        }

        try {
            const member = await ctx.getChatMember(target.id);
            if (['creator', 'administrator'].includes(member.status)) {
                return;
            }
        } catch (e) { }

        const existing = await logic.getActiveVoteForUser(db, ctx.chat.id, target.id);
        if (existing) {
            return ctx.reply("⚠️ C'è già una votazione attiva per questo utente.", {
                reply_to_message_id: existing.poll_message_id
            });
        }

        const reason = text.replace(/^[@!.\/]admin\s*/i, '').trim() || "Nessun motivo specificato";
        const duration = config.voteban_duration_minutes || 30;
        const required = config.voteban_threshold || 5;

        const expires = duration === 0
            ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
            : new Date(Date.now() + duration * 60000).toISOString();

        const voters = [{ id: ctx.from.id, name: ctx.from.first_name, vote: 'yes' }];

        const voteId = await logic.createVote(db, {
            target, chat: ctx.chat, initiator: ctx.from, reason, required, expires, voters
        });

        const { text: msgText, keyboard } = ui.getVoteMessage(target, ctx.from, reason, 1, 0, required, expires, voteId, duration === 0);
        const msg = await ctx.reply(msgText, { reply_markup: keyboard, parse_mode: 'Markdown' });

        await logic.setPollMessageId(db, voteId, msg.message_id);
    });

    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;

        // Config Handlers
        if (data.startsWith("vb_")) {
            const config = db.getGuildConfig(ctx.chat.id);
            const fromSettings = isFromSettingsMenu(ctx);

            if (data === "vb_close") return ctx.deleteMessage();

            if (data === "vb_toggle") {
                db.updateGuildConfig(ctx.chat.id, { voteban_enabled: config.voteban_enabled ? 0 : 1 });
            } else if (data === "vb_thr") {
                const val = config.voteban_threshold || 5;
                const thresholds = [3, 5, 7, 10];
                const idx = thresholds.indexOf(val);
                const nextVal = thresholds[(idx + 1) % thresholds.length];
                db.updateGuildConfig(ctx.chat.id, { voteban_threshold: nextVal });
            } else if (data === "vb_dur") {
                const val = config.voteban_duration_minutes;
                const durations = [15, 30, 60, 0];
                const idx = durations.indexOf(val);
                const nextVal = durations[(idx + 1) % durations.length];
                db.updateGuildConfig(ctx.chat.id, { voteban_duration_minutes: nextVal });
            } else if (data === "vb_tier") {
                let val = config.voteban_initiator_tier || 0;
                const tiers = [0, 1, 2, 3, -1];
                const idx = tiers.indexOf(val);
                const nextVal = tiers[(idx + 1) % tiers.length];
                db.updateGuildConfig(ctx.chat.id, { voteban_initiator_tier: nextVal });
            }
            await ui.sendConfigUI(ctx, db, true, fromSettings);
            return;
        }

        // Vote Action Handlers
        if (data.startsWith("vote_")) {
            const parts = data.split('_');
            const action = parts[1];
            const voteId = parseInt(parts[2]);

            if (isNaN(voteId)) return ctx.answerCallbackQuery("Errore: ID votazione non valido.");

            const vote = await logic.getVote(db, voteId);
            if (!vote || vote.status !== 'active') return ctx.answerCallbackQuery("Votazione scaduta o inesistente.");

            const member = await ctx.getChatMember(ctx.from.id);
            const isAdmin = ['creator', 'administrator'].includes(member.status);

            // Admin Logic
            if (isAdmin) {
                if (action === "yes" || action === "ban") {
                    await actions.finalizeVote(ctx, db, vote, "forced_ban", ctx.from);
                    return;
                }
                if (action === "no" || action === "pardon") {
                    await actions.finalizeVote(ctx, db, vote, "pardon", ctx.from);
                    return;
                }
            }

            // Voting Logic
            const config = db.getGuildConfig(ctx.chat.id);
            if (ctx.userTier < (config.voteban_voter_tier || 0)) {
                return ctx.answerCallbackQuery("Tier insufficiente per votare.");
            }

            let voters = [];
            try { voters = JSON.parse(vote.voters || '[]'); } catch (e) { }

            const hasVoted = voters.some(v => (typeof v === 'object' ? v.id : v) === ctx.from.id);
            if (hasVoted) return ctx.answerCallbackQuery("Hai già votato!");

            voters.push({ id: ctx.from.id, name: ctx.from.first_name, vote: action });
            let yes = vote.votes_yes;
            let no = vote.votes_no;

            if (action === 'yes') yes++;
            else if (action === 'no') no++;

            await logic.updateVote(db, voteId, yes, no, voters);

            await ctx.answerCallbackQuery("Voto registrato.");

            if ((yes + no) >= vote.required_votes) {
                vote.votes_yes = yes;
                vote.votes_no = no;
                vote.voters = JSON.stringify(voters);

                const outcome = yes > no ? 'passed' : 'failed';
                await actions.finalizeVote(ctx, db, vote, outcome, null);
            } else {
                const { text, keyboard } = ui.getVoteMessage(
                    { id: vote.target_user_id, username: vote.target_username },
                    { id: vote.initiated_by, username: "..." },
                    vote.reason, yes, no, vote.required_votes, vote.expires_at, voteId, false
                );
                try { await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' }); } catch (e) { }
            }
        }

        await next();
    });
}

module.exports = {
    registerCommands
};
