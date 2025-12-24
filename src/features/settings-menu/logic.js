const i18n = require('../../i18n');
const ui = require('./ui');

const antiSpam = require('../anti-spam');
const aiModeration = require('../ai-moderation');
const antiEditAbuse = require('../anti-edit-abuse');
const intelligentProfiler = require('../intelligent-profiler');
const keywordMonitor = require('../keyword-monitor');
const languageMonitor = require('../language-monitor');
const linkMonitor = require('../link-monitor');
const nsfwMonitor = require('../nsfw-monitor');
const visualImmuneSystem = require('../visual-immune-system');
const voteBan = require('../vote-ban');
const adminLogger = require('../admin-logger');
const staffCoordination = require('../staff-coordination');
const intelNetwork = require('../intel-network');
const modalPatterns = require('../modal-patterns');

const casBan = require('../cas-ban');
const welcomeSystem = require('../welcome-system');

async function routeToFeature(ctx, feature) {
    // Call the feature's sendConfigUI with fromSettings=true
    // Note: features need to export sendConfigUI

    switch (feature) {
        case 'welcome':
            if (welcomeSystem.ui.sendWelcomeMenu) await welcomeSystem.ui.sendWelcomeMenu(ctx, true);
            break;
        case 'antispam':
            // DISABLED
            await ctx.answerCallbackQuery(i18n.t(await i18n.getLanguage(ctx.chat.id), 'settings.disabled_modules.antispam'));
            break;
        case 'aimod':
            if (aiModeration.sendConfigUI) await aiModeration.sendConfigUI(ctx, true, true);
            break;
        case 'antiedit':
            if (antiEditAbuse.sendConfigUI) await antiEditAbuse.sendConfigUI(ctx, true, true);
            break;
        case 'profiler':
            // DISABLED
            await ctx.answerCallbackQuery(i18n.t(await i18n.getLanguage(ctx.chat.id), 'settings.disabled_modules.profiler'));
            break;
        case 'badwords':
            // keywordMonitor has Wizard, might be tricky. Check sendConfigUI
            if (keywordMonitor.sendConfigUI) await keywordMonitor.sendConfigUI(ctx, true, true);
            break;
        case 'lang':
            if (languageMonitor.sendConfigUI) await languageMonitor.sendConfigUI(ctx, true, true);
            break;
        case 'links':
            if (linkMonitor.sendConfigUI) await linkMonitor.sendConfigUI(ctx, true, true);
            break;
        case 'nsfw':
            if (nsfwMonitor.sendConfigUI) await nsfwMonitor.sendConfigUI(ctx, true, true);
            break;
        case 'visual':
            // DISABLED TEMPORARILY
            await ctx.answerCallbackQuery(i18n.t(await i18n.getLanguage(ctx.chat.id), 'settings.disabled_modules.visual'));
            break;
        case 'voteban':
            if (voteBan.sendConfigUI) await voteBan.sendConfigUI(ctx, true, true);
            break;
        case 'logger':
            if (adminLogger.sendConfigUI) await adminLogger.sendConfigUI(ctx, true, true);
            break;
        case 'staff':
            if (staffCoordination.sendConfigUI) {
                await staffCoordination.sendConfigUI(ctx, true, true);
            }
            break;
        case 'intel':
            // DISABLED
            await ctx.answerCallbackQuery(i18n.t(await i18n.getLanguage(ctx.chat.id), 'settings.disabled_modules.intel'));
            break;
        case 'modals':
            if (modalPatterns.sendConfigUI) await modalPatterns.sendConfigUI(ctx, true, true);
            break;
        case 'casban':
            if (casBan.sendConfigUI) await casBan.sendConfigUI(ctx, true, true);
            else await ctx.answerCallbackQuery(i18n.t(await i18n.getLanguage(ctx.chat.id), 'settings.disabled_modules.casban_hint'));
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
