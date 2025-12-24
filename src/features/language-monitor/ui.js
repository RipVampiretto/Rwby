const { safeEdit } = require('../../utils/error-handlers');
const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);
    const enabled = config.lang_enabled ? t('common.on') : t('common.off');
    const action = i18n.formatAction(guildId, config.lang_action || 'delete');

    let allowed = [];
    if (config.allowed_languages) {
        if (Array.isArray(config.allowed_languages)) {
            allowed = config.allowed_languages;
        } else if (typeof config.allowed_languages === 'string') {
            try {
                allowed = JSON.parse(config.allowed_languages);
            } catch (e) {}
        }
    }
    if (allowed.length === 0) allowed = ['it', 'en'];

    let text =
        `${t('language.title')}\n\n` + `${t('language.description')}\n\n` + `${t('language.status')}: ${enabled}`;

    // Show details only when enabled
    if (config.lang_enabled) {
        text += `\n${t('language.action')}: ${action}`;
        text += `\n${t('language.allowed')}: ${allowed.join(', ').toUpperCase()}`;

        if (!config.staff_group_id && (config.lang_action || 'delete') === 'report_only') {
            text += `\n${t('common.warnings.no_staff_group')}`;
        }
    }

    // Build keyboard dynamically
    const rows = [];
    rows.push([{ text: `${t('language.buttons.filter')}: ${enabled}`, callback_data: 'lng_toggle' }]);

    // Show options only when enabled
    if (config.lang_enabled) {
        // Language toggles
        const common = ['it', 'en', 'ru', 'es', 'fr', 'de'];
        const langButtons = common.map(l => {
            const isAllowed = allowed.includes(l);
            return { text: `${isAllowed ? '✅' : '⬜'} ${l.toUpperCase()}`, callback_data: `lng_set:${l}` };
        });
        for (let i = 0; i < langButtons.length; i += 3) {
            rows.push(langButtons.slice(i, i + 3));
        }

        rows.push([{ text: `${t('language.buttons.action')}: ${action}`, callback_data: 'lng_act' }]);

        // Parse log events and show single log button based on action
        let logEvents = {};
        if (config.log_events) {
            if (typeof config.log_events === 'string') {
                try {
                    logEvents = JSON.parse(config.log_events);
                } catch (e) {}
            } else if (typeof config.log_events === 'object') {
                logEvents = config.log_events;
            }
        }

        const currentAction = config.lang_action || 'delete';
        if (currentAction === 'report_only') {
            const logRep = logEvents['lang_report'] ? t('common.on') : t('common.off');
            rows.push([{ text: `📢 Log: ${logRep}`, callback_data: 'lng_log_report' }]);
        } else {
            const logDel = logEvents['lang_delete'] ? t('common.on') : t('common.off');
            rows.push([{ text: `🗑️ Log: ${logDel}`, callback_data: 'lng_log_delete' }]);
        }
    }

    rows.push([{ text: t('common.back'), callback_data: 'settings_main' }]);

    const keyboard = { inline_keyboard: rows };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'HTML' }, 'language-monitor');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    }
}

module.exports = {
    sendConfigUI
};
