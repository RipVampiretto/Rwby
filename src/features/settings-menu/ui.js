const i18n = require('../../i18n');
const featureGating = require('../feature-gating');

let db = null;

function setDb(database) {
    db = database;
}

/**
 * Ordered list of features for the settings menu
 * Each entry: [buttonKey, featureName, i18nKey]
 */
const MENU_BUTTONS = [
    ['welcome', 'welcome_system', 'settings.buttons.welcome'],
    ['staff', 'staff_coordination', 'settings.buttons.staff'],
    ['voteban', 'report_system', 'settings.buttons.voteban'],
    ['antiedit', 'edit_monitor', 'settings.buttons.antiedit'],
    ['lang', 'language_filter', 'settings.buttons.lang'],
    ['nsfw', 'media_filter', 'settings.buttons.nsfw'],
    ['mentions', 'mention_filter', 'settings.buttons.mentions'],
    ['casban', 'global_blacklist', 'settings.buttons.casban'],
    ['links', 'link_filter', 'settings.buttons.links'],
    ['badwords', 'word_filter', 'settings.buttons.badwords'],
    ['modals', 'spam_patterns', 'settings.buttons.modals']
];

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
            } catch (e) { }
        } else {
            await ctx.reply(text, { parse_mode: 'HTML' });
        }
        return;
    }

    const text = `${t('settings.main.title')}\n\n${t('settings.main.subtitle')}`;

    // Build buttons array based on permissions
    const visibleButtons = [];
    for (const [key, featureName, i18nKey] of MENU_BUTTONS) {
        const canUse = await featureGating.canUseFeature(guildId, featureName);
        if (canUse) {
            visibleButtons.push({
                text: t(i18nKey),
                callback_data: `set_goto:${key}`
            });
        }
    }

    // Arrange in rows of 2
    const rows = [];
    for (let i = 0; i < visibleButtons.length; i += 2) {
        rows.push(visibleButtons.slice(i, i + 2));
    }

    // Bot Language (always available)
    rows.push([{ text: t('settings.buttons.ui_language'), callback_data: 'set_goto:ui_lang' }]);

    // Close
    rows.push([{ text: t('settings.main.close'), callback_data: 'settings_close' }]);

    const keyboard = { inline_keyboard: rows };

    if (isEdit) {
        try {
            await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
        } catch (e) {
            if (e.error_code === 429) {
                try {
                    await ctx.answerCallbackQuery('⚠️ Slow down!');
                } catch (ignore) { }
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
    const currentLang = lang;
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
            } catch (ignore) { }
        }
    }
}

module.exports = {
    setDb,
    sendMainMenu,
    sendLanguageUI
};
