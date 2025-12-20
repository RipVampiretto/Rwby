const logger = require('../../middlewares/logger');
const trust = require('./trust');

let db = null;
let _botInstance = null;

function init(database, bot) {
    db = database;
    _botInstance = bot;
}

async function handleReport(ctx) {
    if (!ctx.message.reply_to_message) {
        return ctx.reply("❌ Rispondi al messaggio (o utente) da segnalare.");
    }

    const guildStats = trust.getGuildTrust(ctx.chat.id);
    if (guildStats.tier < 1) {
        return ctx.reply("❌ Il tuo gruppo deve essere almeno Tier 1 (Verified) per inviare report globali.");
    }

    const targetUser = ctx.message.reply_to_message.from;
    if (!targetUser) return ctx.reply("❌ Impossibile identificare l'utente target.");

    const reason = ctx.message.text.split(' ').slice(1).join(' ') || 'Suspicious activity';

    // Create Bill
    try {
        // Get parliament info
        const globalConfig = db.getDb().prepare('SELECT * FROM global_config WHERE id = 1').get();
        if (!globalConfig || !globalConfig.parliament_group_id) return ctx.reply("❌ Network non configurato.");

        let billsThread = null;
        if (globalConfig.global_topics) {
            try { billsThread = JSON.parse(globalConfig.global_topics).bills; } catch (e) { }
        }

        // Insert Bill
        const res = db.getDb().prepare(`
            INSERT INTO bills (type, target, source_guild, metadata, status)
            VALUES (?, ?, ?, ?, 'pending')
        `).run('global_ban', targetUser.id, ctx.chat.id, JSON.stringify({
            reason: reason,
            evidence: ctx.message.reply_to_message.text || 'Media/NoContent',
            reporter: ctx.from.id,
            targetUsername: targetUser.username
        }));

        // Notify Parliament
        const text = `📜 **NUOVO BILL #${res.lastInsertRowid}**\n` +
            `Da: ${ctx.chat.title}\n` +
            `Target: ${targetUser.first_name} (@${targetUser.username})\n` +
            `Reason: ${reason}\n\n` +
            `Richiede Ratifica.`;

        const keyboard = {
            inline_keyboard: [
                [{ text: "✅ Ratifica", callback_data: `bill_yes:${res.lastInsertRowid}` }, { text: "❌ Rigetta", callback_data: `bill_no:${res.lastInsertRowid}` }]
            ]
        };

        if (_botInstance) {
            await _botInstance.api.sendMessage(globalConfig.parliament_group_id, text, {
                message_thread_id: billsThread,
                reply_markup: keyboard,
                parse_mode: 'Markdown'
            });
        }

        await ctx.reply("✅ Report inviato al network (Bill Created).");

    } catch (e) {
        logger.error(`[intel-network] Error sending report: ${e.message}`);
        await ctx.reply("❌ Errore invio report.");
    }
}

module.exports = {
    init,
    handleReport
};
