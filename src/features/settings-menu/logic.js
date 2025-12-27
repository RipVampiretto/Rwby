const i18n = require('../../i18n');
const ui = require('./ui');
const logger = require('../../middlewares/logger');

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
const mentionFilter = require('../mention-filter');

async function routeToFeature(ctx, feature) {
    logger.debug(`[Settings] Routing to feature: ${feature}`, ctx);

    try {
        switch (feature) {
            case 'welcome':
                logger.info(`[Settings] Opening Welcome System config`, ctx);
                if (welcomeSystem.ui.sendWelcomeMenu) await welcomeSystem.ui.sendWelcomeMenu(ctx, true);
                break;
            case 'antiedit':
                logger.info(`[Settings] Opening Edit Monitor config`, ctx);
                if (editMonitor.sendConfigUI) await editMonitor.sendConfigUI(ctx, true, true);
                break;
            case 'badwords':
                logger.info(`[Settings] Opening Word Filter config`, ctx);
                if (wordFilter.sendConfigUI) await wordFilter.sendConfigUI(ctx, true, true);
                break;
            case 'lang':
                logger.info(`[Settings] Opening Language Filter config`, ctx);
                if (languageFilter.sendConfigUI) await languageFilter.sendConfigUI(ctx, true, true);
                break;
            case 'links':
                logger.info(`[Settings] Opening Link Filter config`, ctx);
                if (linkFilter.sendConfigUI) await linkFilter.sendConfigUI(ctx, true, true);
                break;
            case 'nsfw':
                logger.info(`[Settings] Opening Media Filter config`, ctx);
                if (mediaFilter.sendConfigUI) await mediaFilter.sendConfigUI(ctx, true, true);
                break;
            case 'voteban':
                logger.info(`[Settings] Opening Report System config`, ctx);
                if (reportSystem.sendConfigUI) await reportSystem.sendConfigUI(ctx, true, true);
                break;
            case 'logger':
                logger.info(`[Settings] Opening Action Log config`, ctx);
                if (actionLog.sendConfigUI) await actionLog.sendConfigUI(ctx, true, true);
                break;
            case 'staff':
                logger.info(`[Settings] Opening Staff Coordination config`, ctx);
                if (staffCoordination.sendConfigUI) {
                    await staffCoordination.sendConfigUI(ctx, true, true);
                }
                break;
            case 'modals':
                logger.info(`[Settings] Opening Spam Patterns config`, ctx);
                if (spamPatterns.sendConfigUI) await spamPatterns.sendConfigUI(ctx, true, true);
                break;
            case 'casban':
                logger.info(`[Settings] Opening Global Blacklist config`, ctx);
                if (globalBlacklist.sendConfigUI) await globalBlacklist.sendConfigUI(ctx, true, true);
                break;
            case 'mentions':
                logger.info(`[Settings] Opening Mention Filter config`, ctx);
                if (mentionFilter.sendConfigUI) await mentionFilter.sendConfigUI(ctx, true, true);
                break;
            case 'ui_lang':
                logger.info(`[Settings] Opening Language Selection UI`, ctx);
                await ui.sendLanguageUI(ctx);
                break;
            default:
                logger.warn(`[Settings] Unknown feature route requested: ${feature}`, ctx);
        }
        logger.debug(`[Settings] Successfully routed to feature: ${feature}`, ctx);
    } catch (e) {
        logger.error(`[Settings] Error routing to feature ${feature}: ${e.message}`, ctx);
    }
}

async function handleLanguageChange(ctx, langCode) {
    const guildId = ctx.chat.id;
    const availableLangs = i18n.getAvailableLanguages();

    logger.info(`[Settings] Language change requested: ${langCode} for guild ${guildId}`, ctx);

    if (!availableLangs[langCode]) {
        logger.warn(`[Settings] Invalid language code requested: ${langCode}`, ctx);
        await ctx.answerCallbackQuery('Invalid language');
        return;
    }

    const oldLang = await i18n.getLanguage(guildId);
    i18n.setLanguage(guildId, langCode);
    logger.info(`[Settings] Language changed: ${oldLang} -> ${langCode} for guild ${guildId}`, ctx);

    // Use the NEW language for the success message
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);
    await ctx.answerCallbackQuery(t('settings.language.changed', { lang: availableLangs[langCode] }));

    // Refresh the language UI with new language
    await ui.sendLanguageUI(ctx);
    logger.debug(`[Settings] Language UI refreshed for guild ${guildId}`, ctx);
}

module.exports = {
    routeToFeature,
    handleLanguageChange
};

