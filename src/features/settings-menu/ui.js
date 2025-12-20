const i18n = require('../../i18n');

async function sendMainMenu(ctx, isEdit = false) {
    const guildId = ctx.chat.id;
    const t = (key, params) => i18n.t(guildId, key, params);

    const text = `${t('settings.main.title')}\n\n${t('settings.main.subtitle')}`;

    // Layout: 2 columns, ordered by checking flow (first to last)
    // Flow: Blacklist → Link → Language → Keyword → Modals → NSFW → Anti-Edit → Vote Ban → AI (last)
    const keyboard = {
        inline_keyboard: [
            // === FIRST LINE OF DEFENSE ===
            [
                { text: `${t('settings.buttons.casban')}`, callback_data: "set_goto:casban" },
                { text: `${t('settings.buttons.links')}`, callback_data: "set_goto:links" }
            ],
            [
                { text: `${t('settings.buttons.lang')}`, callback_data: "set_goto:lang" },
                { text: `${t('settings.buttons.badwords')}`, callback_data: "set_goto:badwords" }
            ],
            // === PATTERN DETECTION ===
            [
                { text: `${t('settings.buttons.modals')}`, callback_data: "set_goto:modals" },
                { text: `${t('settings.buttons.nsfw')}`, callback_data: "set_goto:nsfw" }
            ],
            // === BEHAVIOR DETECTION ===
            [
                { text: `${t('settings.buttons.antiedit')}`, callback_data: "set_goto:antiedit" },
                { text: `${t('settings.buttons.voteban')}`, callback_data: "set_goto:voteban" }
            ],
            // === AI (LAST LINE) ===
            [
                { text: `${t('settings.buttons.aimod')}`, callback_data: "set_goto:aimod" }
            ],
            // === ADMIN TOOLS ===
            [
                { text: `${t('settings.buttons.staff')}`, callback_data: "set_goto:staff" },
                { text: `${t('settings.buttons.logger')}`, callback_data: "set_goto:logger" }
            ],
            // === SETTINGS ===
            [
                { text: `${t('settings.buttons.ui_language')}`, callback_data: "set_goto:ui_lang" }
            ],
            [
                { text: `${t('settings.main.close')}`, callback_data: "settings_close" }
            ]
        ]
    };

    if (isEdit) {
        try { await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' }); } catch (e) { }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

async function sendLanguageUI(ctx) {
    const guildId = ctx.chat.id;
    const t = (key, params) => i18n.t(guildId, key, params);
    const currentLang = i18n.getLanguage(guildId);
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
    rows.push([{ text: t('settings.language.back'), callback_data: "settings_main" }]);

    const keyboard = { inline_keyboard: rows };

    try {
        await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    } catch (e) { }
}

module.exports = {
    sendMainMenu,
    sendLanguageUI
};
