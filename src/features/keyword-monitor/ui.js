const { safeEdit } = require('../../utils/error-handlers');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const syncGlobal = config.keyword_sync_global ? '✅ ON' : '❌ OFF';

    const text = `🔤 **PAROLE VIETATE**\n\n` +
        `Blocca messaggi che contengono parole o frasi specifiche proibite a livello globale.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Usa le liste condivise di parole pericolose dall'IntelNetwork\n\n` +
        `Sync Globale: ${syncGlobal}`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "wrd_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `➕ Aggiungi Parola`, callback_data: "wrd_add" }, { text: `📜 Lista`, callback_data: "wrd_list" }],
            [{ text: `🌐 Sync Globale: ${syncGlobal}`, callback_data: "wrd_sync" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'keyword-monitor');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = {
    sendConfigUI
};
