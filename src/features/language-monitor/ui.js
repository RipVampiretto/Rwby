const { safeEdit } = require('../../utils/error-handlers');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.lang_enabled ? '✅ ON' : '❌ OFF';
    const action = (config.lang_action || 'delete').toUpperCase().replace(/_/g, ' ');
    const tierBypass = config.lang_tier_bypass ?? 2;
    const tierDisplay = tierBypass === -1 ? 'OFF' : `${tierBypass}+`;

    let allowed = [];
    try { allowed = JSON.parse(config.allowed_languages || '[]'); } catch (e) { }
    if (allowed.length === 0) allowed = ['it', 'en']; // Visual default

    const text = `🌐 **FILTRO LINGUA**\n\n` +
        `Rileva e blocca messaggi scritti in lingue non permesse.\n` +
        `Utile per mantenere il gruppo focalizzato.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Ignora messaggi molto brevi\n` +
        `• Invia avviso auto-eliminante all'utente\n\n` +
        `Stato: ${enabled}\n` +
        `Bypass da Tier: ${tierDisplay}\n` +
        `Azione: ${action}\n` +
        `Permesse: ${allowed.join(', ').toUpperCase()}`;

    // Language toggles (Common ones) - max 3 per row
    const common = ['it', 'en', 'ru', 'es', 'fr', 'de'];
    const langButtons = common.map(l => {
        const isAllowed = allowed.includes(l);
        return { text: `${isAllowed ? '✅' : '⬜'} ${l.toUpperCase()}`, callback_data: `lng_set:${l}` };
    });
    // Split into rows of 3
    const langRows = [];
    for (let i = 0; i < langButtons.length; i += 3) {
        langRows.push(langButtons.slice(i, i + 3));
    }

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "lng_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `🌐 Filtro: ${enabled}`, callback_data: "lng_toggle" }],
            [{ text: `👤 Bypass Tier: ${tierDisplay}`, callback_data: "lng_tier" }],
            ...langRows,
            [{ text: `👮 Azione: ${action}`, callback_data: "lng_act" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'language-monitor');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = {
    sendConfigUI
};
