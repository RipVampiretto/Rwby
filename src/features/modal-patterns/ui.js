const logic = require('./logic');
const manage = require('./manage');
const { safeEdit } = require('../../utils/error-handlers');
const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);
    const enabled = config.modal_enabled ? t('common.on') : t('common.off');
    const action = i18n.formatAction(guildId, config.modal_action || 'report_only');

    // Count active modals for this group's languages
    let allowedLangs = ['it', 'en'];
    if (config.allowed_languages) {
        if (Array.isArray(config.allowed_languages)) {
            allowedLangs = config.allowed_languages;
        } else if (typeof config.allowed_languages === 'string') {
            try {
                const parsed = JSON.parse(config.allowed_languages);
                if (parsed.length > 0) allowedLangs = parsed;
            } catch (e) { }
        }
    }

    const modals = await logic.getModalsForLanguages(allowedLangs);
    const activeCount = modals.filter(m => m.enabled).length;

    let text =
        `${t('modals.title')}\n\n` +
        `${t('modals.description')}\n\n` +
        `ℹ️ **${t('modals.info_title')}:**\n` +
        `• ${t('modals.info_1', { count: activeCount })}\n` +
        `• ${t('modals.info_2', { languages: allowedLangs.join(', ').toUpperCase() })}\n\n` +
        `${t('modals.status')}: ${enabled}\n` +
        `${t('modals.action')}: ${action}`;

    if (!config.staff_group_id && (config.modal_action || 'report_only') === 'report_only') {
        text += `\n${t('common.warnings.no_staff_group')}\n`;
    }

    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: 'settings_main' }
        : { text: t('common.close'), callback_data: 'mdl_close' };

    const keyboard = {
        inline_keyboard: [
            [{ text: `${t('modals.buttons.system')}: ${enabled}`, callback_data: 'mdl_toggle' }],
            [{ text: `${t('modals.buttons.action')}: ${action}`, callback_data: 'mdl_act' }],
            [{ text: `${t('modals.buttons.manage')} (${activeCount})`, callback_data: 'mdl_list' }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'modal-patterns');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

async function sendModalListUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);

    // Get group's allowed languages
    let allowedLangs = ['it', 'en'];
    if (config.allowed_languages) {
        if (Array.isArray(config.allowed_languages)) {
            allowedLangs = config.allowed_languages;
        } else if (typeof config.allowed_languages === 'string') {
            try {
                const parsed = JSON.parse(config.allowed_languages);
                if (parsed.length > 0) allowedLangs = parsed;
            } catch (e) { }
        }
    }

    const modals = await logic.getModalsForLanguages(allowedLangs);

    if (modals.length === 0) {
        const text = `${t('modals.list.title')}\n\n${t('modals.list.empty')}`;
        const keyboard = {
            inline_keyboard: [[{ text: t('common.back'), callback_data: 'mdl_back' }]]
        };
        if (isEdit) {
            await safeEdit(ctx, text, { reply_markup: keyboard }, 'modal-patterns');
        } else {
            await ctx.reply(text, { reply_markup: keyboard });
        }
        return;
    }

    const text = `${t('modals.list.title')}\n\n${t('modals.list.toggle_info')}\n`;

    // Build toggle buttons for each modal
    const buttons = await Promise.all(
        modals.map(async m => {
            const isEnabled = await logic.isModalEnabledForGuild(guildId, m.id);
            const patterns = logic.safeJsonParse(m.patterns, []);
            const icon = isEnabled ? '✅' : '❌';
            return {
                text: `${icon} ${m.language.toUpperCase()}/${m.category} (${patterns.length})`,
                callback_data: `mdl_tog:${m.id}`
            };
        })
    );

    // Split into rows of 2
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) {
        rows.push(buttons.slice(i, i + 2));
    }
    rows.push([{ text: t('common.back'), callback_data: 'mdl_back' }]);

    const keyboard = { inline_keyboard: rows };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard }, 'modal-patterns');
    } else {
        await ctx.reply(text, { reply_markup: keyboard });
    }
}

module.exports = {
    sendConfigUI,
    sendModalListUI
};
