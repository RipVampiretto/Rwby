// ============================================================================
// VOTE BAN (Community Tribunal)
// ============================================================================

const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');
const { safeDelete, safeEdit, safeBan, safeGetChatMember, handleCriticalError, isFromSettingsMenu } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');

let db = null;
let _botInstance = null;

// Clean expired votes periodically
setInterval(cleanupVotes, 60000);

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Table creation handled in database/index.js

    // Trigger: @admin, !admin, .admin, /admin (reply to message)
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
        if (!config.voteban_enabled) return; // Silently ignore if disabled

        // Check tiers
        // Check tiers
        const reqTier = config.voteban_initiator_tier !== undefined ? config.voteban_initiator_tier : 0;
        if (reqTier !== -1 && ctx.userTier < reqTier) {
            return ctx.reply(`❌ Devi essere almeno T${reqTier} per segnalare.`);
        }

        // Check if target is admin (immune)
        try {
            const member = await ctx.getChatMember(target.id);
            if (['creator', 'administrator'].includes(member.status)) {
                return; // Silently ignore admins
            }
        } catch (e) { }

        // Check active vote
        const existing = db.getDb().prepare("SELECT * FROM active_votes WHERE chat_id = ? AND target_user_id = ? AND status = 'active'").get(ctx.chat.id, target.id);
        if (existing) {
            return ctx.reply("⚠️ C'è già una votazione attiva per questo utente.", {
                reply_to_message_id: existing.poll_message_id
            });
        }

        // Extract reason from trigger text
        const reason = text.replace(/^[@!.\/]admin\s*/i, '').trim() || "Nessun motivo specificato";
        const duration = config.voteban_duration_minutes || 30;
        const required = config.voteban_threshold || 5;

        // Handle disabled duration (0 = no expiry)
        const expires = duration === 0
            ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() // 1 year 
            : new Date(Date.now() + duration * 60000).toISOString();

        // Initial state: Initiator votes "yes" automatically
        const voters = [{ id: ctx.from.id, name: ctx.from.first_name, vote: 'yes' }];

        // Insert vote first to get vote_id
        const insertResult = db.getDb().prepare(`INSERT INTO active_votes (target_user_id, target_username, chat_id, initiated_by, reason, required_votes, expires_at, created_at, votes_yes, voters)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            target.id, target.username || target.first_name, ctx.chat.id, ctx.from.id, reason, required, expires, new Date().toISOString(),
            1, JSON.stringify(voters)
        );
        const voteId = insertResult.lastInsertRowid;

        // Create Vote Message with the actual voteId (starts with 1 yes)
        const { text: msgText, keyboard } = getVoteMessage(target, ctx.from, reason, 1, 0, required, expires, voteId, duration === 0);
        const msg = await ctx.reply(msgText, { reply_markup: keyboard, parse_mode: 'Markdown' });

        // Update the vote with the poll_message_id
        db.getDb().prepare("UPDATE active_votes SET poll_message_id = ? WHERE vote_id = ?").run(msg.message_id, voteId);
    });

    // Command: /voteconfig
    bot.command("voteconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        if (!await isAdmin(ctx, 'vote-ban')) return;

        await sendConfigUI(ctx);
    });

    // Vote UI Handlers
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
                // Cycle: 3 -> 5 -> 7 -> 10 -> 3
                const val = config.voteban_threshold || 5;
                const thresholds = [3, 5, 7, 10];
                const idx = thresholds.indexOf(val);
                const next = thresholds[(idx + 1) % thresholds.length];
                db.updateGuildConfig(ctx.chat.id, { voteban_threshold: next });
            } else if (data === "vb_dur") {
                // Cycle: 15 -> 30 -> 60 -> 0 (disabled)
                const val = config.voteban_duration_minutes;
                const durations = [15, 30, 60, 0];
                const idx = durations.indexOf(val);
                const next = durations[(idx + 1) % durations.length];
                db.updateGuildConfig(ctx.chat.id, { voteban_duration_minutes: next });
            } else if (data === "vb_tier") {
                // Cycle: 0 -> 1 -> 2 -> 3 -> -1 (OFF) -> 0
                let val = config.voteban_initiator_tier || 0;
                const tiers = [0, 1, 2, 3, -1];
                const idx = tiers.indexOf(val);
                const next = tiers[(idx + 1) % tiers.length];
                db.updateGuildConfig(ctx.chat.id, { voteban_initiator_tier: next });
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

            // Admin Logic: Implicit Force
            if (isAdmin) {
                if (action === "yes" || action === "ban") {
                    await finalizeVote(ctx, vote, "forced_ban", ctx.from);
                    return;
                }
                if (action === "no" || action === "pardon") {
                    await finalizeVote(ctx, vote, "pardon", ctx.from);
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

            // Handle legacy format (array of IDs) or new format (array of objects)
            const hasVoted = voters.some(v => (typeof v === 'object' ? v.id : v) === ctx.from.id);

            if (hasVoted) {
                return ctx.answerCallbackQuery("Hai già votato!");
            }

            voters.push({ id: ctx.from.id, name: ctx.from.first_name, vote: action });
            let yes = vote.votes_yes;
            let no = vote.votes_no;

            if (action === 'yes') yes++;
            else if (action === 'no') no++;

            db.getDb().prepare("UPDATE active_votes SET votes_yes = ?, votes_no = ?, voters = ? WHERE vote_id = ?")
                .run(yes, no, JSON.stringify(voters), voteId);

            await ctx.answerCallbackQuery("Voto registrato.");

            // Check threshold (Quorum: Total Votes >= Required)
            if ((yes + no) >= vote.required_votes) {
                // Update vote object with latest state for logging
                vote.votes_yes = yes;
                vote.votes_no = no;
                vote.voters = JSON.stringify(voters);

                // Determine outcome: Majority wins (Tie = Save)
                const outcome = yes > no ? 'passed' : 'failed';
                await finalizeVote(ctx, vote, outcome, null);
            } else {
                // Update UI
                const { text, keyboard } = getVoteMessage(
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

function getVoteMessage(target, initiator, reason, yes, no, required, expires, voteId, noExpiry = false) {
    const minLeft = Math.max(0, Math.ceil((new Date(expires) - Date.now()) / 60000));
    const timeDisplay = noExpiry ? '♾️' : `${minLeft} min`;
    const text = `⚖️ **TRIBUNALE DELLA COMMUNITY**\n\n` +
        `📊 **Voti:** ${yes + no}/${required}\n` +
        `⏱️ **Scade:** ${timeDisplay}\n\n` +
        `_La community decide se bannare questo utente._`;

    const k = {
        inline_keyboard: [
            [{ text: `✅ Banna (${yes})`, callback_data: `vote_yes_${voteId}` }, { text: `🛡️ Salva (${no})`, callback_data: `vote_no_${voteId}` }]
        ]
    };
    return { text, keyboard: k };
}

async function finalizeVote(ctx, vote, status, admin) {
    db.getDb().prepare("UPDATE active_votes SET status = ? WHERE vote_id = ?").run(status, vote.vote_id);

    // Prepare log details
    let details = '';
    try {
        const voters = JSON.parse(vote.voters || '[]');
        const fmt = (v) => `<a href="tg://user?id=${v.id}">${v.name}</a>`;
        const yes = voters.filter(v => typeof v === 'object' && v.vote === 'yes').map(fmt).join(', ') || 'Nessuno';
        const no = voters.filter(v => typeof v === 'object' && v.vote === 'no').map(fmt).join(', ') || 'Nessuno';
        details = `\n\n✅ Favorevoli: ${yes}\n🛡️ Contrari: ${no}`;
    } catch (e) { }

    if (status === 'passed' || status === 'forced_ban') {
        try {
            await ctx.editMessageText(`⚖️ **TRIBUNALE CHIUSO**\n\nL'utente @${vote.target_username} è stato BANNATO.\nEsito: ${status === 'forced_ban' ? 'Forzato da Admin' : 'Votazione Conclusa'}`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } });

            // Delete after 1 minute
            setTimeout(() => { try { ctx.deleteMessage().catch(() => { }); } catch (e) { } }, 60000);

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
        } catch (e) { logger.error(`[vote-ban] Finalize vote error: ${e.message}`); }
    } else {
        await ctx.editMessageText(`⚖️ **TRIBUNALE CHIUSO**\n\nL'utente @${vote.target_username} è SALVO.\nEsito: ${status === 'pardon' ? 'Graziato da Admin' : 'Votazione Fallita'}`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } });

        // Delete after 1 minute
        setTimeout(() => { try { ctx.deleteMessage().catch(() => { }); } catch (e) { } }, 60000);
    }

    // Log outcome (Ban or Save)
    // We use 'vote_ban' as eventType to ensure visibility if logging is enabled for this module,
    // but the reason clearly states the outcome.

    let tags = ['#VOTE_BAN'];
    if (status === 'passed' || status === 'forced_ban') tags.push('#BAN');
    else tags.push('#SAVE');

    if (adminLogger.getLogEvent()) {
        let cause = 'Votazione Conclusa';
        if (status === 'forced_ban') cause = 'Forzato da Admin';
        else if (status === 'pardon') cause = 'Graziato da Admin';
        else if (status === 'failed') cause = 'Votazione Fallita';

        let cleanReason = vote.reason === 'Nessun motivo specificato' ? '' : ` - ${vote.reason}`;

        adminLogger.getLogEvent()({
            guildId: vote.chat_id,
            guildName: ctx.chat.title,
            eventType: 'vote_ban',
            customTags: tags,
            targetUser: { id: vote.target_user_id, username: vote.target_username, first_name: vote.target_username },
            executorAdmin: admin,
            reason: `Esito: ${cause}${cleanReason}${details}`,
            isGlobal: true
        });
    }
}

async function cleanupVotes() {
    if (!db || !_botInstance) return;

    const now = new Date();
    const votes = db.getDb().prepare("SELECT * FROM active_votes WHERE status = 'active'").all();

    for (const vote of votes) {
        // Check expire
        const expires = new Date(vote.expires_at);
        if (expires < now) {
            db.getDb().prepare("UPDATE active_votes SET status = 'expired' WHERE vote_id = ?").run(vote.vote_id);

            // Prepare details for log and message
            let details = '';
            try {
                const voters = JSON.parse(vote.voters || '[]');
                const fmt = (v) => `<a href="tg://user?id=${v.id}">${v.name}</a>`;
                const yes = voters.filter(v => typeof v === 'object' && v.vote === 'yes').map(fmt).join(', ') || 'Nessuno';
                const no = voters.filter(v => typeof v === 'object' && v.vote === 'no').map(fmt).join(', ') || 'Nessuno';
                details = `\n\n✅ Favorevoli: ${yes}\n🛡️ Contrari: ${no}`;
            } catch (e) { }



            // Get Guild Name
            let guildName = 'Unknown Group';
            try { const chat = await _botInstance.api.getChat(vote.chat_id); guildName = chat.title; } catch (e) { }

            // Log outcome
            if (adminLogger.getLogEvent()) {
                let cleanReason = vote.reason === 'Nessun motivo specificato' ? '' : ` - ${vote.reason}`;

                adminLogger.getLogEvent()({
                    guildId: vote.chat_id,
                    guildName: guildName,
                    eventType: 'vote_ban',
                    customTags: ['#VOTE_BAN', '#EXPIRED'],
                    targetUser: { id: vote.target_user_id, username: vote.target_username, first_name: vote.target_username },
                    executorAdmin: { first_name: 'System (Expired)' },
                    reason: `Esito: Scaduto (Voti Insufficienti)${cleanReason}${details}`,
                    isGlobal: true
                });
            }

            try {
                await _botInstance.api.editMessageText(vote.chat_id, vote.poll_message_id,
                    `⚖️ **TRIBUNALE CHIUSO**\n\nL'utente @${vote.target_username} è SALVO (Scaduto).\nEsito: Votazione Scaduta`,
                    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } }
                );
                // Delete after 1 minute
                setTimeout(() => {
                    try { _botInstance.api.deleteMessage(vote.chat_id, vote.poll_message_id).catch(() => { }); } catch (e) { }
                }, 60000);
            } catch (e) { }
            continue;
        }

        // Update Timer UI
        try {
            const { text, keyboard } = getVoteMessage(
                { id: vote.target_user_id, username: vote.target_username },
                null, vote.reason, vote.votes_yes, vote.votes_no, vote.required_votes, vote.expires_at, vote.vote_id, false
            );
            await _botInstance.api.editMessageText(vote.chat_id, vote.poll_message_id, text, { reply_markup: keyboard, parse_mode: 'Markdown' });
        } catch (e) {
            // Ignore "message is not modified" errors
        }
    }
}

async function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.voteban_enabled ? '✅ ON' : '❌ OFF';
    const thr = config.voteban_threshold || 5;
    const dur = config.voteban_duration_minutes;
    const durDisplay = dur === 0 ? '❌ Disattivato' : `${dur} min`;
    const tier = config.voteban_initiator_tier !== undefined ? config.voteban_initiator_tier : 0;
    const tierDisplay = tier === -1 ? 'OFF' : `T${tier}`;

    const text = `⚖️ **VOTE BAN**\n\n` +
        `Permette alla community di decidere se bannare un utente.\n` +
        `Trigger: @admin  !admin  .admin  /admin\n\n` +
        `ℹ️ **Uso:**\n` +
        `Rispondi al messaggio dell'utente con uno dei trigger.\n\n` +
        `Stato: ${enabled}\n` +
        `Voti Richiesti: ${thr}\n` +
        `Timer: ${durDisplay}\n` +
        `Tier Initiator: ${tierDisplay}`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "vb_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `⚖️ Sys: ${enabled}`, callback_data: "vb_toggle" }],
            [{ text: `📊 Soglia: ${thr}`, callback_data: "vb_thr" }],
            [{ text: `⏱️ Durata: ${durDisplay}`, callback_data: "vb_dur" }],
            [{ text: `🏷️ Tier: ${tierDisplay}`, callback_data: "vb_tier" }],
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
