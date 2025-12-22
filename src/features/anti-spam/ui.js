const { safeEdit } = require('../../utils/error-handlers');
const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);
    const enabled = config.spam_enabled ? '✅ ON' : '❌ OFF';
    const sens = config.spam_sensitivity || 'medium';
    const sensLabel = sens.toUpperCase();
    const actVol = (config.spam_action_volume || 'delete').toUpperCase().replace(/_/g, ' ');
    const actRep = (config.spam_action_repetition || 'delete').toUpperCase().replace(/_/g, ' ');

    const statusText =
        `🛡️ **ANTI-SPAM**\n\n` +
        `Blocca chi invia troppi messaggi veloci o copia-incolla ripetuti.\n` +
        `Protegge il gruppo da flood e bot.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Sensibilità: Regola quanto deve essere severo\n` +
        `• Rileva: Messaggi a raffica e ripetizioni\n` +
        `• Utenti fidati vengono ignorati\n\n` +
        `Stato: ${enabled}\n` +
        `Sensibilità: ${sensLabel}`;

    // Callback suffix
    const s = fromSettings ? ':1' : ':0';

    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: 'settings_main' }
        : { text: t('common.close'), callback_data: `spam_close${s}` };

    const keyboard = {
        inline_keyboard: [
            [{ text: `${t('antispam.buttons.monitor')}: ${enabled}`, callback_data: `spam_toggle${s}` }],
            [{ text: `${t('antispam.buttons.sensitivity')}: ${sensLabel}`, callback_data: `spam_sens${s}` }],
            [{ text: `${t('antispam.buttons.action_flood')}: ${actVol}`, callback_data: `spam_act_vol${s}` }],
            [{ text: `${t('antispam.buttons.action_repeat')}: ${actRep}`, callback_data: `spam_act_rep${s}` }],
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
