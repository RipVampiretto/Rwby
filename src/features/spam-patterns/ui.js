const logic = require('./logic');
const manage = require('./manage');
const { safeEdit } = require('../../utils/error-handlers');
const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);
    const enabled = config.spam_patterns_enabled ? t('common.on') : t('common.off');
    const action = i18n.formatAction(guildId, config.spam_patterns_action || 'report_only');

    // Parse log_events to check notification status
    let logEvents = {};
    if (config.log_events) {
        if (typeof config.log_events === 'string') {
            try {
                logEvents = JSON.parse(config.log_events);
            } catch (e) { }
        } else if (typeof config.log_events === 'object') {
            logEvents = config.log_events;
        }
    }

    // Determine which log event to check based on action
    const currentAction = config.spam_patterns_action || 'report_only';
    const logEventKey = currentAction === 'delete' ? 'modal_delete' : 'modal_report';
    const notifyEnabled = logEvents[logEventKey] ? true : false;
    const notifyStatus = notifyEnabled ? '✅' : '❌';

    // Count active modals (total enabled categories) - exclude hidden
    const allModals = await logic.getAllModals();
    const modals = allModals.filter(m => !m.hidden);
    const categories = [...new Set(modals.map(m => m.category))];
    let activeCount = 0;

    for (const cat of categories) {
        if (await manage.isCategoryEnabledForGuild(guildId, cat)) activeCount++;
    }

    let text =
        `${t('modals.title')}\n\n` +
        `${t('modals.description')}\n\n` +
        `ℹ️ <b>${t('modals.info_title')}:</b>\n` +
        `• ${t('modals.info_global', { count: activeCount, total: categories.length })}\n\n` +
        `${t('modals.status')}: ${enabled}`;

    // Show details only when enabled
    if (config.spam_patterns_enabled) {
        text += `\n${t('modals.action')}: ${action}`;
        text += `\n📋 ${t('modals.notify_local') || 'Notifica locale'}: ${notifyStatus}`;

        if (!config.staff_group_id && (config.spam_patterns_action || 'report_only') === 'report_only') {
            text += `\n${t('common.warnings.no_staff_group')}`;
        }
    }

    // Build keyboard dynamically
    const rows = [];
    rows.push([{ text: `${t('modals.buttons.system')}: ${enabled}`, callback_data: 'mdl_toggle' }]);

    // Show options only when enabled
    if (config.spam_patterns_enabled) {
        rows.push([{ text: `${t('modals.buttons.action')}: ${action}`, callback_data: 'mdl_act' }]);
        rows.push([{ text: `📋 ${t('modals.buttons.notify') || 'Notifica'}: ${notifyStatus}`, callback_data: 'mdl_notify' }]);
        rows.push([
            { text: `${t('modals.buttons.manage')} (${activeCount}/${categories.length})`, callback_data: 'mdl_list' }
        ]);
    }

    rows.push([{ text: t('common.back'), callback_data: 'settings_main' }]);

    const keyboard = { inline_keyboard: rows };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'HTML' }, 'modal-patterns');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    }
}

async function sendModalListUI(ctx, db, isEdit = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const allModals = await logic.getAllModals();
    // Filter out hidden modals for UI display
    const modals = allModals.filter(m => !m.hidden);

    // Group by category
    const categories = [...new Set(modals.map(m => m.category))];
    categories.sort();

    if (categories.length === 0) {
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

    // Build toggle buttons for each category
    const buttons = await Promise.all(
        categories.map(async cat => {
            const isEnabled = await manage.isCategoryEnabledForGuild(guildId, cat);
            const icon = isEnabled ? '✅' : '❌';

            // Try to translate category, fallback to raw name
            let catName = t(`modals.categories.${cat}`);
            if (catName === `modals.categories.${cat}`) catName = cat.charAt(0).toUpperCase() + cat.slice(1);

            return {
                text: `${icon} ${catName}`,
                callback_data: `mdl_cat:${cat}`
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
