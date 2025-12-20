/**
 * Send configuration UI
 */
async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.edit_monitor_enabled ? '✅ ON' : '❌ OFF';
    const lockT0 = config.edit_lock_tier0 ? '✅ ON' : '❌ OFF';
    const thr = (config.edit_similarity_threshold || 0.5) * 100;
    const actInj = (config.edit_link_injection_action || 'report_only').toUpperCase().replace('_', ' ');
    const actGen = (config.edit_abuse_action || 'report_only').toUpperCase().replace('_', ' ');
    const tierBypass = config.edit_tier_bypass ?? 2;

    const text = `✏️ **ANTI-EDIT**\n\n` +
        `Controlla se qualcuno modifica i messaggi vecchi per inserire link o truffe.\n` +
        `Protegge lo storico della chat.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Blocca l'inserimento di link nascosti dopo l'invio\n` +
        `• Impedisce di cambiare completamente il senso di una frase\n\n` +
        `Stato: ${enabled}\n` +
        `Bypass da Tier: ${tierBypass === -1 ? 'OFF' : tierBypass + '+'}\n` +
        `Sensibilità: ${thr}%\n` +
        `Azione (Link Inj): ${actInj}\n` +
        `Azione (Altro): ${actGen}`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "edt_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `✏️ Monitor: ${enabled}`, callback_data: "edt_toggle" }],
            [{ text: `👤 Bypass Tier: ${tierBypass}+`, callback_data: "edt_tier" }],
            [{ text: `📊 Soglia: ${thr}%`, callback_data: "edt_thr" }],
            [{ text: `🔗 Link Inj: ${actInj}`, callback_data: "edt_act_inj" }],
            [{ text: `👮 Altro: ${actGen}`, callback_data: "edt_act_gen" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        try { await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' }); } catch (e) { }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = {
    sendConfigUI
};
