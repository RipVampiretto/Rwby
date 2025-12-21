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

    const guildStats = await trust.getGuildTrust(ctx.chat.id);
    if (!guildStats || guildStats.tier < 1) {
        return ctx.reply("❌ Il tuo gruppo deve essere almeno Tier 1 (Verified) per inviare report globali.");
    }

    const targetUser = ctx.message.reply_to_message.from;
    if (!targetUser) return ctx.reply("❌ Impossibile identificare l'utente target.");

    const reason = ctx.message.text.split(' ').slice(1).join(' ') || 'Suspicious activity';

    try {
        const globalConfig = await db.queryOne('SELECT * FROM global_config WHERE id = 1');
        if (!globalConfig || !globalConfig.parliament_group_id) return ctx.reply("❌ Network non configurato.");

        let billsThread = null;
        if (globalConfig.global_topics) {
            try {
                const topics = typeof globalConfig.global_topics === 'string'
                    ? JSON.parse(globalConfig.global_topics)
                    : globalConfig.global_topics;
                billsThread = topics.bills;
            } catch (e) { }
        }

        const res = await db.query(`
            INSERT INTO bills (type, target, source_guild, metadata, status)
            VALUES ($1, $2, $3, $4, 'pending')
            RETURNING id
        `, ['global_ban', targetUser.id, ctx.chat.id, JSON.stringify({
            reason: reason,
            evidence: ctx.message.reply_to_message.text || 'Media/NoContent',
            reporter: ctx.from.id,
            targetUsername: targetUser.username
        })]);

        const billId = res.rows[0].id;

        const text = `📜 **NUOVO BILL #${billId}**\n` +
            `Da: ${ctx.chat.title}\n` +
            `Target: ${targetUser.first_name} (@${targetUser.username})\n` +
            `Reason: ${reason}\n\n` +
            `Richiede Ratifica.`;

        const keyboard = {
            inline_keyboard: [
                [{ text: "✅ Ratifica", callback_data: `bill_yes:${billId}` }, { text: "❌ Rigetta", callback_data: `bill_no:${billId}` }]
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
