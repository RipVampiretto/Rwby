const { safeEdit } = require('../../utils/error-handlers');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.link_enabled ? '✅ ON' : '❌ OFF';
    const sync = config.link_sync_global ? '✅ ON' : '❌ OFF';
    const tierBypass = config.link_tier_bypass ?? 2;

    const text = `🔗 **CONTROLLO LINK**\n\n` +
        `Controlla i link inviati per proteggere da scam e siti pericolosi.\n` +
        `Usa una lista globale di siti malevoli sempre aggiornata.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Blocca siti di phishing e truffe note\n` +
        `• Link sconosciuti vengono segnalati ai SuperAdmin\n\n` +
        `Stato: ${enabled}\n` +
        `Bypass da Tier: ${tierBypass === -1 ? 'OFF' : tierBypass + '+'}\n` +
        `Sync Globale: ${sync}`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "lnk_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `🔗 Monitor: ${enabled}`, callback_data: "lnk_toggle" }],
            [{ text: `👤 Bypass Tier: ${tierBypass}+`, callback_data: "lnk_tier" }],
            [{ text: `🌐 Sync Globale: ${sync}`, callback_data: "lnk_sync" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'link-monitor');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = {
    sendConfigUI
};
