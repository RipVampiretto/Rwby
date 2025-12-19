// ============================================================================
// VOTE BAN (Community Tribunal)
// ============================================================================

const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');

let db = null;
let _botInstance = null;

// Clean expired votes periodically
setInterval(cleanupVotes, 60000);

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Table creation handled in database/index.js

    // Command: /voteban (reply to message)
    bot.command("voteban", async (ctx) => {
        if (ctx.chat.type === 'private') return;

        if (!ctx.message.reply_to_message) {
            return ctx.reply("⚖️ Rispondi al messaggio dell'utente che vuoi bannare.");
        }

        const target = ctx.message.reply_to_message.from;
        if (target.is_bot) return ctx.reply("❌ Non puoi bannare i bot.");
        if (target.id === ctx.from.id) return ctx.reply("❌ Non puoi autobannarti.");

        const config = db.getGuildConfig(ctx.chat.id);
        if (!config.voteban_enabled) return ctx.reply("❌ Vote ban disabilitato.");

        // Check tiers
        if (ctx.userTier < (config.voteban_initiator_tier !== undefined ? config.voteban_initiator_tier : 1)) {
            return ctx.reply(`❌ Devi essere almeno Tier ${config.voteban_initiator_tier || 1} per avviare un voto.`);
        }

        // Check if target is admin (immune)
        try {
            const member = await ctx.getChatMember(target.id);
            if (['creator', 'administrator'].includes(member.status)) {
                return ctx.reply("❌ Non puoi votare contro un admin.");
            }
        } catch (e) { }

        // Check active vote
        const existing = db.getDb().prepare("SELECT * FROM active_votes WHERE chat_id = ? AND target_user_id = ? AND status = 'active'").get(ctx.chat.id, target.id);
        if (existing) {
            return ctx.reply("⚠️ C'è già una votazione attiva per questo utente.", {
                reply_to_message_id: existing.poll_message_id
            });
        }

        const reason = ctx.message.text.split(' ').slice(1).join(' ') || "Nessun motivo specificato";
        const duration = config.voteban_duration_minutes || 30;
        const required = config.voteban_threshold || 5;
        const expires = new Date(Date.now() + duration * 60000).toISOString();

        // Insert vote first to get vote_id
        const insertResult = db.getDb().prepare(`INSERT INTO active_votes (target_user_id, target_username, chat_id, initiated_by, reason, required_votes, expires_at, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
            target.id, target.username || target.first_name, ctx.chat.id, ctx.from.id, reason, required, expires, new Date().toISOString()
        );
        const voteId = insertResult.lastInsertRowid;

        // Create Vote Message with the actual voteId
        const { text, keyboard } = getVoteMessage(target, ctx.from, reason, 0, 0, required, expires, voteId);
        const msg = await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });

        // Update the vote with the poll_message_id
        db.getDb().prepare("UPDATE active_votes SET poll_message_id = ? WHERE vote_id = ?").run(msg.message_id, voteId);
    });

    // Command: /voteconfig
    bot.command("voteconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        const member = await ctx.getChatMember(ctx.from.id);
        if (!['creator', 'administrator'].includes(member.status)) return;

        await sendConfigUI(ctx);
    });

    // Vote UI Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;

        // Config Handlers
        if (data.startsWith("vb_")) {
            const config = db.getGuildConfig(ctx.chat.id);

            // Check if we came from settings menu
            let fromSettings = false;
            try {
                const markup = ctx.callbackQuery.message.reply_markup;
                if (markup && markup.inline_keyboard) {
                    fromSettings = markup.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'settings_main'));
                }
            } catch (e) { }

            if (data === "vb_close") return ctx.deleteMessage();

            if (data === "vb_toggle") {
                db.updateGuildConfig(ctx.chat.id, { voteban_enabled: config.voteban_enabled ? 0 : 1 });
            } else if (data === "vb_thr") {
                let val = config.voteban_threshold || 5;
                val = val >= 20 ? 3 : val + 1;
                db.updateGuildConfig(ctx.chat.id, { voteban_threshold: val });
            } else if (data === "vb_dur") {
                let val = config.voteban_duration_minutes || 30;
                val = val >= 120 ? 10 : val + 10;
                db.updateGuildConfig(ctx.chat.id, { voteban_duration_minutes: val });
            } else if (data === "vb_tier") {
                let val = config.voteban_initiator_tier || 1;
                val = val >= 3 ? 0 : val + 1;
                db.updateGuildConfig(ctx.chat.id, { voteban_initiator_tier: val });
            }
            await sendConfigUI(ctx, true, fromSettings);
            return;
        }

        // Vote Action Handlers
        if (data.startsWith("vote_")) {
            const parts = data.split('_');
            const action = parts[1]; // yes, no, ban (admin), pardon (admin)
            const voteId = parseInt(parts[2]);

            if (isNaN(voteId)) {
                return ctx.answerCallbackQuery("Errore: ID votazione non valido.");
            }

            const vote = db.getDb().prepare("SELECT * FROM active_votes WHERE vote_id = ?").get(voteId);
            if (!vote || vote.status !== 'active') return ctx.answerCallbackQuery("Votazione scaduta o inesistente.");

            const member = await ctx.getChatMember(ctx.from.id);
            const isAdmin = ['creator', 'administrator'].includes(member.status);

            // Admin Overrides
            if (action === "ban" && isAdmin) {
                await finalizeVote(ctx, vote, "forced_ban", ctx.from);
                return;
            }
            if (action === "pardon" && isAdmin) {
                await finalizeVote(ctx, vote, "pardon", ctx.from);
                return;
            }

            // Voting Logic
            const config = db.getGuildConfig(ctx.chat.id);
            if (ctx.userTier < (config.voteban_voter_tier || 0)) {
                return ctx.answerCallbackQuery("Tier insufficiente per votare.");
            }

            let voters = JSON.parse(vote.voters || '[]');
            if (voters.includes(ctx.from.id)) {
                return ctx.answerCallbackQuery("Hai già votato!");
            }

            voters.push(ctx.from.id);
            let yes = vote.votes_yes;
            let no = vote.votes_no;

            if (action === 'yes') yes++;
            else if (action === 'no') no++;

            db.getDb().prepare("UPDATE active_votes SET votes_yes = ?, votes_no = ?, voters = ? WHERE vote_id = ?")
                .run(yes, no, JSON.stringify(voters), voteId);

            await ctx.answerCallbackQuery("Voto registrato.");

            // Check threshold
            if (yes >= vote.required_votes) {
                await finalizeVote(ctx, vote, "passed", null);
            } else {
                // Update UI
                const { text, keyboard } = getVoteMessage(
                    { id: vote.target_user_id, username: vote.target_username },
                    { id: vote.initiated_by, username: "..." }, // initiator info not critical for update
                    vote.reason, yes, no, vote.required_votes, vote.expires_at, voteId
                );
                try { await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' }); } catch (e) { }
            }
        }
    });
}

function getVoteMessage(target, initiator, reason, yes, no, required, expires, voteId) {
    const minLeft = Math.max(0, Math.ceil((new Date(expires) - Date.now()) / 60000));
    const text = `⚖️ **TRIBUNALE DELLA COMMUNITY**\n\n` +
        `👤 **Accusato:** @${target.username || target.first_name}\n` +
        `📝 **Motivo:** ${reason}\n\n` +
        `📊 **Voti:** ${yes}/${required} (N: ${no})\n` +
        `⏱️ **Scade:** ${minLeft} min\n\n` +
        `_La community decide se bannare questo utente._`;

    const k = {
        inline_keyboard: [
            [{ text: `✅ Banna (${yes})`, callback_data: `vote_yes_${voteId}` }, { text: `🛡️ Salva (${no})`, callback_data: `vote_no_${voteId}` }],
            [{ text: "🔨 FORZA BAN", callback_data: `vote_ban_${voteId}` }, { text: "🕊️ PERDONA", callback_data: `vote_pardon_${voteId}` }]
        ]
    };
    return { text, keyboard: k };
}

async function finalizeVote(ctx, vote, status, admin) {
    db.getDb().prepare("UPDATE active_votes SET status = ? WHERE vote_id = ?").run(status, vote.vote_id);

    if (status === 'passed' || status === 'forced_ban') {
        try {
            await ctx.editMessageText(`⚖️ **TRIBUNALE CHIUSO**\n\nL'utente @${vote.target_username} è stato BANNATO.\nEsito: ${status === 'forced_ban' ? 'Forzato da Admin' : 'Votazione Conclusa'}`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } });

            await ctx.banChatMember(vote.target_user_id);
            userReputation.modifyFlux(vote.target_user_id, vote.chat_id, -200, 'vote_ban');

            if (superAdmin.forwardBanToParliament) {
                superAdmin.forwardBanToParliament({
                    user: { id: vote.target_user_id, username: vote.target_username },
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: `Vote Ban: ${vote.reason}`,
                    evidence: `Votes: ${vote.votes_yes} Yes / ${vote.votes_no} No`,
                    flux: userReputation.getLocalFlux(vote.target_user_id, vote.chat_id)
                });
            }

            if (adminLogger.getLogEvent()) {
                adminLogger.getLogEvent()({
                    guildId: vote.chat_id,
                    eventType: 'ban',
                    targetUser: { id: vote.target_user_id, username: vote.target_username },
                    executorAdmin: admin,
                    reason: `Vote Ban (${status})`,
                    isGlobal: true
                });
            }
        } catch (e) { console.error(e); }
    } else {
        await ctx.editMessageText(`⚖️ **TRIBUNALE CHIUSO**\n\nL'utente @${vote.target_username} è SALVO.\nEsito: ${status === 'pardon' ? 'Graziato da Admin' : 'Votazione Fallita'}`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } });
    }
}

async function cleanupVotes() {
    if (!db) return;
    const expired = db.getDb().prepare("SELECT * FROM active_votes WHERE status = 'active' AND expires_at < ?").all(new Date().toISOString());

    for (const vote of expired) {
        db.getDb().prepare("UPDATE active_votes SET status = 'expired' WHERE vote_id = ?").run(vote.vote_id);
    }
}

async function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.voteban_enabled ? '✅ ON' : '❌ OFF';
    const thr = config.voteban_threshold || 5;
    const dur = config.voteban_duration_minutes || 30;
    const tier = config.voteban_initiator_tier || 1;

    const text = `⚖️ **VOTE BAN CONFIG**\n` +
        `Stato: ${enabled}\n` +
        `Soglia: ${thr} voti\n` +
        `Durata: ${dur} min\n` +
        `Tier Min: ${tier}`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "vb_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `⚖️ Sys: ${enabled}`, callback_data: "vb_toggle" }],
            [{ text: `📊 Soglia: ${thr}`, callback_data: "vb_thr" }],
            [{ text: `⏱️ Durata: ${dur}`, callback_data: "vb_dur" }],
            [{ text: `🏷️ Tier: ${tier}`, callback_data: "vb_tier" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        try { await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' }); } catch (e) { }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = { register, sendConfigUI };
