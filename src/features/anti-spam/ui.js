const { safeEdit } = require('../../utils/error-handlers');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.spam_enabled ? '✅ ON' : '❌ OFF';
    const sens = (config.spam_sensitivity || 'medium').toUpperCase();
    const actVol = (config.spam_action_volume || 'delete').toUpperCase().replace(/_/g, ' ');
    const actRep = (config.spam_action_repetition || 'delete').toUpperCase().replace(/_/g, ' ');

    const statusText = `🛡️ **ANTI-SPAM**\n\n` +
        `Blocca chi invia troppi messaggi veloci o copia-incolla ripetuti.\n` +
        `Protegge il gruppo da flood e bot.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Sensibilità: Regola quanto deve essere severo\n` +
        `• Rileva: Messaggi a raffica e ripetizioni\n` +
        `• Utenti fidati vengono ignorati\n\n` +
        `Stato: ${enabled}\n` +
        `Sensibilità: ${sens}`;

    // Callback suffix
    const s = fromSettings ? ':1' : ':0';

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: `spam_close${s}` };

    const keyboard = {
        inline_keyboard: [
            [{ text: `🛡️ Monitor: ${enabled}`, callback_data: `spam_toggle${s}` }],
            [{ text: `🌡️ Sens: ${sens}`, callback_data: `spam_sens${s}` }],
            [{ text: `⚡ Flood: ${actVol}`, callback_data: `spam_act_vol${s}` }],
            [{ text: `🔁 Repeat: ${actRep}`, callback_data: `spam_act_rep${s}` }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, statusText, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'anti-spam');
    } else {
        await ctx.reply(statusText, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = {
    sendConfigUI
};
