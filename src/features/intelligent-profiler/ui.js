const { safeEdit } = require('../../utils/error-handlers');
const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const config = await db.fetchGuildConfig(ctx.chat.id);
    const enabled = config.profiler_enabled ? '✅ ON' : '❌ OFF';
    const actLink = (config.profiler_action_link || 'delete').toUpperCase().replace(/_/g, ' ');
    const actFwd = (config.profiler_action_forward || 'delete').toUpperCase().replace(/_/g, ' ');
    const actPat = (config.profiler_action_pattern || 'report_only').toUpperCase().replace(/_/g, ' ');

    let warning = '';
    if (
        !config.staff_group_id &&
        (config.profiler_action_pattern === 'report_only' ||
            config.profiler_action_link === 'report_only' ||
            config.profiler_action_forward === 'report_only')
    ) {
        warning = `\n${i18n.t(ctx.lang || 'en', 'common.warnings.no_staff_group')}\n`;
    }

    const lang = await i18n.getLanguage(ctx.chat.id);
    const t = (key, params) => i18n.t(lang, key, params);

    const text =
        `🔍 **PROFILER NUOVI UTENTI**\n\n` +
        `Analizza i nuovi arrivati per bloccare bot e spammer istantanei.\n` +
        `Smette di controllare gli utenti appena diventano fidati.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Controlla se inviano subito Link o Inoltrati\n` +
        `• Rileva frasi tipiche da bot ("guadagna subito", ecc)\n` +
        `• Protegge dalle ondate di account falsi\n\n` +
        `Stato: ${enabled}\n` +
        `Azione Link: ${actLink}\n` +
        `Azione Fwd: ${actFwd}\n` +
        `Azione Pattern: ${actPat}` +
        warning;

    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: 'settings_main' }
        : { text: t('common.close'), callback_data: 'prf_close' };

    const keyboard = {
        inline_keyboard: [
            [{ text: `${t('profiler.buttons.profiler')}: ${enabled}`, callback_data: 'prf_toggle' }],
            [{ text: `${t('profiler.buttons.link')}: ${actLink}`, callback_data: 'prf_act_link' }],
            [{ text: `${t('profiler.buttons.forward')}: ${actFwd}`, callback_data: 'prf_act_fwd' }],
            [{ text: `${t('profiler.buttons.pattern')}: ${actPat}`, callback_data: 'prf_act_pat' }],
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
