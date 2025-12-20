const { safeEdit } = require('../../utils/error-handlers');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.profiler_enabled ? '✅ ON' : '❌ OFF';
    const actLink = (config.profiler_action_link || 'delete').toUpperCase().replace(/_/g, ' ');
    const actFwd = (config.profiler_action_forward || 'delete').toUpperCase().replace(/_/g, ' ');
    const actPat = (config.profiler_action_pattern || 'report_only').toUpperCase().replace(/_/g, ' ');

    const text = `🔍 **PROFILER NUOVI UTENTI**\n\n` +
        `Analizza i nuovi arrivati per bloccare bot e spammer istantanei.\n` +
        `Smette di controllare gli utenti appena diventano fidati.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Controlla se inviano subito Link o Inoltrati\n` +
        `• Rileva frasi tipiche da bot ("guadagna subito", ecc)\n` +
        `• Protegge dalle ondate di account falsi\n\n` +
        `Stato: ${enabled}\n` +
        `Azione Link: ${actLink}\n` +
        `Azione Fwd: ${actFwd}\n` +
        `Azione Pattern: ${actPat}`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "prf_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `🔍 Profiler: ${enabled}`, callback_data: "prf_toggle" }],
            [{ text: `🔗 Link: ${actLink}`, callback_data: "prf_act_link" }],
            [{ text: `📤 Forward: ${actFwd}`, callback_data: "prf_act_fwd" }],
            [{ text: `📝 Pattern: ${actPat}`, callback_data: "prf_act_pat" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'intelligent-profiler');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = {
    sendConfigUI
};
