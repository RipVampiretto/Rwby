const i18n = require('../../i18n');
const featureGating = require('../feature-gating');

let db = null;

function setDb(database) {
    db = database;
}

/**
 * Button definition with feature mapping
 */
const BUTTON_FEATURES = {
    welcome: 'welcome_system',
    staff: 'staff_coordination',
    voteban: 'report_system',
    antiedit: 'edit_monitor',
    lang: 'language_filter',
    nsfw: 'media_filter',
    mentions: 'mention_filter',
    casban: 'global_blacklist',
    links: 'link_filter',
    badwords: 'word_filter',
    modals: 'spam_patterns'
};

async function sendMainMenu(ctx, isEdit = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    // Check if group is blacklisted
    const blacklisted = await featureGating.isGuildBlacklisted(guildId);
    if (blacklisted) {
        const text =
            `⛔ <b>ACCESSO BLOCCATO</b>\n\n` +
            `Questo gruppo non può accedere alle impostazioni.\n` +
            `📝 Motivo: ${blacklisted.reason}\n\n` +
            `<i>Contatta un super admin per assistenza.</i>`;

        if (isEdit) {
            try {
                await ctx.editMessageText(text, { parse_mode: 'HTML' });
            } catch (e) {}
        } else {
            await ctx.reply(text, { parse_mode: 'HTML' });
        }
        return;
    }

    const text = `${t('settings.main.title')}\n\n${t('settings.main.subtitle')}`;

    // Check which features are available
    const canUse = async feature => {
        const featureName = BUTTON_FEATURES[feature];
        if (!featureName) return true; // No mapping = always show
        return await featureGating.canUseFeature(guildId, featureName);
    };

    // Build keyboard dynamically based on permissions
    const rows = [];

    // ━━━ GESTIONE ━━━
    const managementButtons = [];
    if (await canUse('welcome')) {
        managementButtons.push({ text: `${t('settings.buttons.welcome')}`, callback_data: 'set_goto:welcome' });
    }
    if (await canUse('staff')) {
        managementButtons.push({ text: `${t('settings.buttons.staff')}`, callback_data: 'set_goto:staff' });
    }
    if (managementButtons.length > 0) {
        rows.push([{ text: `${t('settings.headers.management')}`, callback_data: 'settings_main' }]);
        rows.push(managementButtons);
    }

    // Voteban
    if (await canUse('voteban')) {
        if (managementButtons.length === 0) {
            rows.push([{ text: `${t('settings.headers.management')}`, callback_data: 'settings_main' }]);
        }
        rows.push([{ text: `${t('settings.buttons.voteban')}`, callback_data: 'set_goto:voteban' }]);
    }

    // ━━━ FILTRI ━━━
    const filterRow1 = [];
    if (await canUse('antiedit')) {
        filterRow1.push({ text: `${t('settings.buttons.antiedit')}`, callback_data: 'set_goto:antiedit' });
    }
    if (await canUse('lang')) {
        filterRow1.push({ text: `${t('settings.buttons.lang')}`, callback_data: 'set_goto:lang' });
    }

    const filterRow2 = [];
    if (await canUse('nsfw')) {
        filterRow2.push({ text: `${t('settings.buttons.nsfw')}`, callback_data: 'set_goto:nsfw' });
    }
    if (await canUse('mentions')) {
        filterRow2.push({ text: `${t('settings.buttons.mentions')}`, callback_data: 'set_goto:mentions' });
    }

    if (filterRow1.length > 0 || filterRow2.length > 0) {
        rows.push([{ text: `${t('settings.headers.filters')}`, callback_data: 'settings_main' }]);
        if (filterRow1.length > 0) rows.push(filterRow1);
        if (filterRow2.length > 0) rows.push(filterRow2);
    }

    // ━━━ GLOBALE ━━━
    const globalRow1 = [];
    if (await canUse('casban')) {
        globalRow1.push({ text: `${t('settings.buttons.casban')}`, callback_data: 'set_goto:casban' });
    }
    if (await canUse('links')) {
        globalRow1.push({ text: `${t('settings.buttons.links')}`, callback_data: 'set_goto:links' });
    }

    const globalRow2 = [];
    if (await canUse('badwords')) {
        globalRow2.push({ text: `${t('settings.buttons.badwords')}`, callback_data: 'set_goto:badwords' });
    }
    if (await canUse('modals')) {
        globalRow2.push({ text: `${t('settings.buttons.modals')}`, callback_data: 'set_goto:modals' });
    }

    if (globalRow1.length > 0 || globalRow2.length > 0) {
        rows.push([{ text: `${t('settings.headers.global')}`, callback_data: 'settings_main' }]);
        if (globalRow1.length > 0) rows.push(globalRow1);
        if (globalRow2.length > 0) rows.push(globalRow2);
    }

    // Bot Language (always available)
    rows.push([{ text: `${t('settings.buttons.ui_language')}`, callback_data: 'set_goto:ui_lang' }]);

    // Close
    rows.push([{ text: `${t('settings.main.close')}`, callback_data: 'settings_close' }]);

    const keyboard = { inline_keyboard: rows };

    if (isEdit) {
        try {
            await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
        } catch (e) {
            if (e.error_code === 429) {
                try {
                    await ctx.answerCallbackQuery('⚠️ Slow down!');
                } catch (ignore) {}
            }
        }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    }
}

async function sendLanguageUI(ctx) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);
    const currentLang = lang; // Already loaded above
    const availableLangs = i18n.getAvailableLanguages();

    const text = `${t('settings.language.title')}\n\n${t('settings.language.subtitle')}\n${t('settings.language.current', { lang: availableLangs[currentLang] })}`;

    // Create buttons for each available language
    const langButtons = Object.entries(availableLangs).map(([code, name]) => {
        const isSelected = code === currentLang ? '✓ ' : '';
        return { text: `${isSelected}${name}`, callback_data: `settings_ui_lang:${code}` };
    });

    // Arrange in rows of 2
    const rows = [];
    for (let i = 0; i < langButtons.length; i += 2) {
        rows.push(langButtons.slice(i, i + 2));
    }

    // Add back button
    rows.push([{ text: t('settings.language.back'), callback_data: 'settings_main' }]);

    const keyboard = { inline_keyboard: rows };

    try {
        await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    } catch (e) {
        if (e.error_code === 429) {
            try {
                await ctx.answerCallbackQuery('⚠️ Slow down!');
            } catch (ignore) {}
        }
    }
}

module.exports = {
    setDb,
    sendMainMenu,
    sendLanguageUI
};
