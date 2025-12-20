const { safeEdit } = require('../../utils/error-handlers');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.casban_enabled !== 0 ? '✅ ON' : '❌ OFF';

    const text = `🚫 **GLOBAL BLACKLIST**\n\n` +
        `Lista globale di utenti malevoli conosciuti.\n\n` +
        `ℹ️ **Come funziona:**\n` +
        `• Banna automaticamente utenti in blacklist\n` +
        `• Lista aggiornata automaticamente ogni 24h\n` +
        `• Protegge da spammer e scammer conosciuti\n\n` +
        `Stato: ${enabled}`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "cas_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `🚫 Sistema: ${enabled}`, callback_data: "cas_toggle" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'cas-ban');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = {
    sendConfigUI
};
