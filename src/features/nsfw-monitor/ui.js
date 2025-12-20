const { safeEdit } = require('../../utils/error-handlers');
const loggerUtil = require('../../middlewares/logger');
const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const t = (key, params) => i18n.t(guildId, key, params);

    loggerUtil.debug(`[nsfw-monitor] sendConfigUI called - isEdit: ${isEdit}, fromSettings: ${fromSettings}, chatId: ${guildId}`);

    try {
        const config = db.getGuildConfig(guildId);
        const enabled = config.nsfw_enabled ? t('common.on') : t('common.off');
        const action = (config.nsfw_action || 'delete').toUpperCase();
        const thr = (config.nsfw_threshold || 0.7) * 100;
        const tierBypass = config.nsfw_tier_bypass ?? 2;

        // Toggles
        const p = config.nsfw_check_photos ? '✅' : '❌';
        const v = config.nsfw_check_videos ? '✅' : '❌';
        const g = config.nsfw_check_gifs ? '✅' : '❌';
        const s = config.nsfw_check_stickers ? '✅' : '❌';

        const text = `${t('nsfw.title')}\n\n` +
            `${t('nsfw.description')}\n\n` +
            `ℹ️ <b>${t('nsfw.info_title')}:</b>\n` +
            `• ${t('nsfw.info_1')}\n` +
            `• ${t('nsfw.info_2')}\n` +
            `• ${t('nsfw.info_3')}\n\n` +
            `${t('nsfw.status')}: ${enabled}\n` +
            `${t('nsfw.tier_bypass')}: ${tierBypass === -1 ? 'OFF' : tierBypass + '+'}\n` +
            `${t('nsfw.action')}: ${action}\n` +
            `${t('nsfw.threshold')}: ${thr}%\n` +
            `${t('nsfw.check_types')}: Foto ${p} | Video ${v} | GIF ${g} | Sticker ${s}`;

        const closeBtn = fromSettings
            ? { text: t('common.back'), callback_data: "settings_main" }
            : { text: t('common.close'), callback_data: "nsf_close" };

        const keyboard = {
            inline_keyboard: [
                [{ text: `${t('nsfw.buttons.monitor')}: ${enabled}`, callback_data: "nsf_toggle" }],
                [{ text: `${t('nsfw.buttons.tier')}: ${tierBypass === -1 ? 'OFF' : tierBypass + '+'}`, callback_data: "nsf_tier" }],
                [{ text: `${t('nsfw.buttons.action')}: ${action}`, callback_data: "nsf_act" }, { text: `${t('nsfw.buttons.threshold')}: ${thr}%`, callback_data: "nsf_thr" }],
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
        try {
            await ctx.answerCallbackQuery(`Error: ${e.message.substring(0, 50)}`);
        } catch (e2) { }
    }
}

module.exports = {
    sendConfigUI
};
