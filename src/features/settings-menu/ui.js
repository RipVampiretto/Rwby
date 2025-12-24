const i18n = require('../../i18n');

let db = null;

function setDb(database) {
    db = database;
}

async function sendMainMenu(ctx, isEdit = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const text = `${t('settings.main.title')}\n\n${t('settings.main.subtitle')}`;

    // Layout: Organized by category for better UX
    // Layout: Organized by category for better UX
    const keyboard = {
        inline_keyboard: [
            // ━━━ GESTIONE ━━━
            [{ text: `${t('settings.headers.management')}`, callback_data: 'settings_main' }],
            [
                { text: `${t('settings.buttons.welcome')}`, callback_data: 'set_goto:welcome' },
                { text: `${t('settings.buttons.staff')}`, callback_data: 'set_goto:staff' }
            ],
            [{ text: `${t('settings.buttons.voteban')}`, callback_data: 'set_goto:voteban' }],

            // ━━━ FILTRI ━━━
            [{ text: `${t('settings.headers.filters')}`, callback_data: 'settings_main' }],
            [
                { text: `${t('settings.buttons.antiedit')}`, callback_data: 'set_goto:antiedit' },
                { text: `${t('settings.buttons.lang')}`, callback_data: 'set_goto:lang' }
            ],
            [
                { text: `${t('settings.buttons.nsfw')}`, callback_data: 'set_goto:nsfw' },
                { text: `${t('settings.buttons.mentions')}`, callback_data: 'set_goto:mentions' }
            ],

            // ━━━ GLOBALE ━━━
            [{ text: `${t('settings.headers.global')}`, callback_data: 'settings_main' }],
            [
                { text: `${t('settings.buttons.casban')}`, callback_data: 'set_goto:casban' },
                { text: `${t('settings.buttons.links')}`, callback_data: 'set_goto:links' }
            ],
            [
                { text: `${t('settings.buttons.badwords')}`, callback_data: 'set_goto:badwords' },
                { text: `${t('settings.buttons.modals')}`, callback_data: 'set_goto:modals' }
            ],

            // Bot Language
            [{ text: `${t('settings.buttons.ui_language')}`, callback_data: 'set_goto:ui_lang' }],

            // Close
            [{ text: `${t('settings.main.close')}`, callback_data: 'settings_close' }]
        ]
    };

    if (isEdit) {
        try {
            await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
        } catch (e) {
            if (e.error_code === 429) {
                try { await ctx.answerCallbackQuery('⚠️ Slow down!'); } catch (ignore) { }
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
            try { await ctx.answerCallbackQuery('⚠️ Slow down!'); } catch (ignore) { }
        }
    }
}

module.exports = {
    setDb,
    sendMainMenu,
    sendLanguageUI
};
