const { safeEdit } = require('../../utils/error-handlers');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const config = await db.fetchGuildConfig(ctx.chat.id);
    const enabled = config.visual_enabled ? '✅ ON' : '❌ OFF';
    const sync = config.visual_sync_global ? '✅ ON' : '❌ OFF';
    const action = (config.visual_action || 'delete').toUpperCase();
    const thr = config.visual_hamming_threshold || 5;

    const text = `🧬 **IMMUNITÀ VISIVA**\n\n` +
        `Riconosce e blocca le immagini che sono già state segnalate in passato.\n` +
        `Anche se vengono leggermente modificate, il bot le riconosce lo stesso.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Blocca meme spam o immagini raid ricorrenti\n` +
        `• Condivide le "impronte" delle immagini cattive con altri gruppi\n` +
        `• Molto veloce ed efficace\n\n` +
        `Stato: ${enabled}\n` +
        `Globale: ${sync}\n` +
        `Azione: ${action}\n` +
        `Precisione: ${thr}`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "vis_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `🧬 Sys: ${enabled}`, callback_data: "vis_toggle" }, { text: `🌐 Sync: ${sync}`, callback_data: "vis_sync" }],
            [{ text: `👮 Azione: ${action}`, callback_data: "vis_act" }],
            [{ text: `🎯 Soglia: ${thr}`, callback_data: "vis_thr" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'visual-immune');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = {
    sendConfigUI
};
