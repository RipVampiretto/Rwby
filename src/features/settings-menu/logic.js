const i18n = require('../../i18n');
const ui = require('./ui');

// Active feature modules (renamed)
const editMonitor = require('../edit-monitor');
const wordFilter = require('../word-filter');
const languageFilter = require('../language-filter');
const linkFilter = require('../link-filter');
const mediaFilter = require('../media-filter');
const reportSystem = require('../report-system');
const actionLog = require('../action-log');
const staffCoordination = require('../staff-coordination');
const spamPatterns = require('../spam-patterns');
const globalBlacklist = require('../global-blacklist');
const welcomeSystem = require('../welcome-system');

async function routeToFeature(ctx, feature) {
    switch (feature) {
        case 'welcome':
            if (welcomeSystem.ui.sendWelcomeMenu) await welcomeSystem.ui.sendWelcomeMenu(ctx, true);
            break;
        case 'antiedit':
            if (editMonitor.sendConfigUI) await editMonitor.sendConfigUI(ctx, true, true);
            break;
        case 'badwords':
            if (wordFilter.sendConfigUI) await wordFilter.sendConfigUI(ctx, true, true);
            break;
        case 'lang':
            if (languageFilter.sendConfigUI) await languageFilter.sendConfigUI(ctx, true, true);
            break;
        case 'links':
            if (linkFilter.sendConfigUI) await linkFilter.sendConfigUI(ctx, true, true);
            break;
        case 'nsfw':
            if (mediaFilter.sendConfigUI) await mediaFilter.sendConfigUI(ctx, true, true);
            break;
        case 'voteban':
            if (reportSystem.sendConfigUI) await reportSystem.sendConfigUI(ctx, true, true);
            break;
        case 'logger':
            if (actionLog.sendConfigUI) await actionLog.sendConfigUI(ctx, true, true);
            break;
        case 'staff':
            if (staffCoordination.sendConfigUI) {
                await staffCoordination.sendConfigUI(ctx, true, true);
            }
            break;
        case 'modals':
            if (spamPatterns.sendConfigUI) await spamPatterns.sendConfigUI(ctx, true, true);
            break;
        case 'casban':
            if (globalBlacklist.sendConfigUI) await globalBlacklist.sendConfigUI(ctx, true, true);
            break;
        case 'ui_lang':
            await ui.sendLanguageUI(ctx);
            break;
    }
}

async function handleLanguageChange(ctx, langCode) {
    const guildId = ctx.chat.id;
    const availableLangs = i18n.getAvailableLanguages();

    if (!availableLangs[langCode]) {
        await ctx.answerCallbackQuery('Invalid language');
        return;
    }

    i18n.setLanguage(guildId, langCode);

    // Use the NEW language for the success message
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);
    await ctx.answerCallbackQuery(t('settings.language.changed', { lang: availableLangs[langCode] }));

    // Refresh the language UI with new language
    await ui.sendLanguageUI(ctx);
}

module.exports = {
    routeToFeature,
    handleLanguageChange
};
