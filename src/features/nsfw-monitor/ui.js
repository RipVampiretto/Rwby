const { safeEdit } = require('../../utils/error-handlers');
const loggerUtil = require('../../middlewares/logger');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    loggerUtil.debug(`[nsfw-monitor] sendConfigUI called - isEdit: ${isEdit}, fromSettings: ${fromSettings}, chatId: ${ctx.chat?.id}`);

    try {
        const config = db.getGuildConfig(ctx.chat.id);
        const enabled = config.nsfw_enabled ? '✅ ON' : '❌ OFF';
        const action = (config.nsfw_action || 'delete').toUpperCase();
        const thr = (config.nsfw_threshold || 0.7) * 100;
        const tierBypass = config.nsfw_tier_bypass ?? 2;

        // Toggles
        const p = config.nsfw_check_photos ? '✅' : '❌';
        const v = config.nsfw_check_videos ? '✅' : '❌';
        const g = config.nsfw_check_gifs ? '✅' : '❌';
        const s = config.nsfw_check_stickers ? '✅' : '❌';

        const text = `🔞 <b>FILTRO NSFW</b>\n\n` +
            `Analizza immagini e video per trovare contenuti non adatti (Nudo, Violenza).\n` +
            `Protegge il gruppo da contenuti scioccanti.\n\n` +
            `ℹ️ <b>Info:</b>\n` +
            `• Funziona su Foto, Video, GIF e Sticker\n` +
            `• Blocca pornografia e immagini violente\n` +
            `• Richiede un po' di tempo per analizzare i video\n\n` +
            `Stato: ${enabled}\n` +
            `Bypass da Tier: ${tierBypass === -1 ? 'OFF' : tierBypass + '+'}\n` +
            `Azione: ${action}\n` +
            `Sensibilità: ${thr}%\n` +
            `Controlla: Foto ${p} | Video ${v} | GIF ${g} | Sticker ${s}`;

        const closeBtn = fromSettings
            ? { text: "🔙 Back", callback_data: "settings_main" }
            : { text: "❌ Chiudi", callback_data: "nsf_close" };

        const keyboard = {
            inline_keyboard: [
                [{ text: `🔞 Monitor: ${enabled}`, callback_data: "nsf_toggle" }],
                [{ text: `👤 Bypass Tier: ${tierBypass === -1 ? 'OFF' : tierBypass + '+'}`, callback_data: "nsf_tier" }],
                [{ text: `👮 Azione: ${action}`, callback_data: "nsf_act" }, { text: `📊 Soglia: ${thr}%`, callback_data: "nsf_thr" }],
                [{ text: `📷 ${p}`, callback_data: "nsf_tog_photo" }, { text: `📹 ${v}`, callback_data: "nsf_tog_video" }],
                [{ text: `🎬 ${g}`, callback_data: "nsf_tog_gif" }, { text: `🪙 ${s}`, callback_data: "nsf_tog_sticker" }],
                [closeBtn]
            ]
        };

        if (isEdit) {
            await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'HTML' }, 'nsfw-monitor');
        } else {
            await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
        }
    } catch (e) {
        loggerUtil.error(`[nsfw-monitor] sendConfigUI error: ${e.message}`);
        // Try to answer callback to prevent loading forever
        try {
            await ctx.answerCallbackQuery(`Errore: ${e.message.substring(0, 50)}`);
        } catch (e2) { }
    }
}

module.exports = {
    sendConfigUI
};
