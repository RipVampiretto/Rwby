/**
 * Send the main configuration UI
 * @param {object} ctx - Telegram context
 * @param {object} db - Database instance
 * @param {boolean} isEdit - Whether to edit existing message
 * @param {boolean} fromSettings - Back button behavior
 */
async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.ai_enabled ? '✅ ON' : '❌ OFF';
    const tierBypass = config.ai_tier_bypass ?? 2;
    const thr = (config.ai_confidence_threshold || 0.75) * 100;

    const text = `🤖 **AI MODERATION**\n\n` +
        `Un'intelligenza artificiale che legge il *senso* dei messaggi.\n` +
        `Riesce a bloccare truffe e contenuti tossici anche se usano parole normali.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Funziona come "ultima spiaggia" dopo altri filtri\n` +
        `• Capisce il contesto della conversazione\n` +
        `• Blocca Scam, NSFW e Spam\n\n` +
        `Stato: ${enabled}\n` +
        `Bypass da Tier: ${tierBypass}+\n` +
        `Soglia Confidenza: ${thr}%`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "ai_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `🤖 AI: ${enabled}`, callback_data: "ai_toggle" }],
            [{ text: `🎭 Contesto: ${config.ai_context_aware ? 'ON' : 'OFF'}`, callback_data: "ai_ctx" }],
            [{ text: `👤 Bypass Tier: ${tierBypass === -1 ? 'OFF' : tierBypass + '+'}`, callback_data: "ai_tier_bypass" }],
            [{ text: "⚙️ Configura Azioni Categoria", callback_data: "ai_config_cats" }],
            [{ text: `📊 Soglia: ${thr}%`, callback_data: "ai_threshold" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        try { await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' }); } catch (e) { }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

/**
 * Send the category configuration UI
 * @param {object} ctx - Telegram context
 * @param {object} db - Database instance
 * @param {boolean} fromSettings - Back button behavior
 */
async function sendCategoryConfigUI(ctx, db, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const cats = ['scam', 'nsfw', 'spam']; // Reduced categories

    const rows = [];
    for (const cat of cats) {
        const action = (config[`ai_action_${cat}`] || 'report_only').toUpperCase().replace('_', ' ');
        rows.push([{ text: `${cat.toUpperCase()}: ${action}`, callback_data: `ai_set_act:${cat}` }]);
    }
    rows.push([{ text: "🔙 Indietro", callback_data: "ai_back_main" }]);

    const text = "⚙️ **AZIONI PER CATEGORIA**\nClick per cambiare (Delete/Ban/Report)";
    try {
        await ctx.editMessageText(text, { reply_markup: { inline_keyboard: rows }, parse_mode: 'Markdown' });
    } catch (e) { }
}

module.exports = {
    sendConfigUI,
    sendCategoryConfigUI
};
