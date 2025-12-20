const { safeEdit } = require('../../utils/error-handlers');

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

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
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
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'vote-ban');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = {
    getVoteMessage,
    sendConfigUI
};
