const i18n = require('../../i18n');

let db = null;

function setDb(database) {
    db = database;
}

async function sendMainMenu(ctx, isEdit = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    // Check if staff group is configured
    const config = db ? await db.fetchGuildConfig(guildId) : null;
    const hasStaffGroup = config && config.staff_group_id;

    // Build warning text
    let warningText = `\n\n${t('settings.main.warning_disabled')}`;
    if (!hasStaffGroup) {
        warningText += `\n${t('settings.main.warning_staff')}`;
    }

    const text = `${t('settings.main.title')}\n\n${t('settings.main.subtitle')}${warningText}`;

    // Layout: Grouped by function for better UX
    // Groups: Ingresso → Contenuti → AI → Anti-Abuso → Admin
    const keyboard = {
        inline_keyboard: [
            // ━━━ INGRESSO ━━━
            [{ text: `${t('settings.buttons.welcome')}`, callback_data: 'set_goto:welcome' }],
            [{ text: `${t('settings.buttons.casban')}`, callback_data: 'set_goto:casban' }],

            // ━━━ FILTRI CONTENUTI ━━━
            [
                { text: `${t('settings.buttons.links')}`, callback_data: 'set_goto:links' },
                { text: `${t('settings.buttons.lang')}`, callback_data: 'set_goto:lang' }
            ],
            [{ text: `${t('settings.buttons.badwords')}`, callback_data: 'set_goto:badwords' }],

            // ━━━ PROTEZIONE AI ━━━
            [
                { text: `${t('settings.buttons.aimod')}`, callback_data: 'set_goto:aimod' },
                { text: `${t('settings.buttons.nsfw')}`, callback_data: 'set_goto:nsfw' }
            ],
            [{ text: `${t('settings.buttons.modals')}`, callback_data: 'set_goto:modals' }],

            // ━━━ ANTI-ABUSO ━━━
            [
                { text: `${t('settings.buttons.antiedit')}`, callback_data: 'set_goto:antiedit' },
                { text: `${t('settings.buttons.voteban')}`, callback_data: 'set_goto:voteban' }
            ],

            // ━━━ AMMINISTRAZIONE ━━━
            [{ text: `${t('settings.buttons.staff')}`, callback_data: 'set_goto:staff' }],
            [{ text: `${t('settings.buttons.ui_language')}`, callback_data: 'set_goto:ui_lang' }],
            [{ text: `${t('settings.main.close')}`, callback_data: 'settings_close' }]
        ]
    };

    if (isEdit) {
        try {
            await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
        } catch (e) { }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
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
        await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    } catch (e) { }
}

module.exports = {
    setDb,
    sendMainMenu,
    sendLanguageUI
};
