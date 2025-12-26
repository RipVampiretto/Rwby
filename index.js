require('dotenv').config();
const { Bot, GrammyError, HttpError } = require("grammy");
const logger = require("./src/middlewares/logger");
const features = require("./src/utils/feature-flags");

// ============================================================================
// INIT BOT
// ============================================================================
// ============================================================================
// INIT BOT
// ============================================================================
const botConfig = process.env.TELEGRAM_API_URL ? {
    client: {
        apiRoot: process.env.TELEGRAM_API_URL
    }
} : {};

const bot = new Bot(process.env.BOT_TOKEN, botConfig);

// ============================================================================
// FEATURE MODULES - Import
// ============================================================================
// Core modules
const userReputation = require("./src/features/user-reputation");
const globalBlacklist = require("./src/features/global-blacklist");
const actionLog = require("./src/features/action-log");
const staffCoordination = require("./src/features/staff-coordination");
const superAdmin = require("./src/features/super-admin");

// Detection modules
const editMonitor = require("./src/features/edit-monitor");
const wordFilter = require("./src/features/word-filter");
const languageFilter = require("./src/features/language-filter");
const spamPatterns = require("./src/features/spam-patterns");
const linkFilter = require("./src/features/link-filter");
const mediaFilter = require("./src/features/media-filter");
const mentionFilter = require("./src/features/mention-filter");

// Community/Interactive modules
const reportSystem = require("./src/features/report-system");
const welcomeSystem = require("./src/features/welcome-system");
const settingsMenu = require("./src/features/settings-menu");

// ============================================================================
// DATABASE INIT
// ============================================================================
const db = require("./src/database");
const i18n = require("./src/i18n");

// ============================================================================
// GLOBAL MIDDLEWARE - Logging & User Cache & Global Ban Check
// ============================================================================
bot.use(async (ctx, next) => {
    // Cache user info (async)
    if (ctx.from) {
        await db.upsertUser(ctx.from);
    }
    if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
        const isNew = await db.upsertGuild(ctx.chat);

        if (isNew && features.isEnabled('superAdmin')) {
            // Don't await to not block the main flow
            superAdmin.notifyNewGroup(ctx.chat.id, ctx.chat.title).catch(err => {
                logger.error(`[index] Failed to notify new group: ${err.message}`);
            });
        }

        // Global Ban Check - if blacklist is enabled, check internal global bans
        // (CAS bans are checked in the cas-ban module)
        if (ctx.from) {
            const config = await db.getGuildConfig(ctx.chat.id);
            if (config.casban_enabled) {
                const isBanned = await db.isUserGloballyBanned(ctx.from.id);
                if (isBanned) {
                    logger.info(`[global-ban] Intercepted globally banned user ${ctx.from.id} in ${ctx.chat.id}`);
                    try {
                        await ctx.banChatMember(ctx.from.id);
                        // Try to delete the message that triggered this
                        if (ctx.message) {
                            await ctx.deleteMessage().catch(() => { });
                        }
                    } catch (e) {
                        logger.warn(`[global-ban] Failed to ban ${ctx.from.id}: ${e.message}`);
                    }
                    return; // Stop processing - user is globally banned
                }
            }
        }
    }

    // Log message with structured context
    const text = ctx.message?.text?.substring(0, 50) || 'Non-text update';
    logger.info(text, ctx);
    await next();
});

// Global i18n middleware
bot.use(i18n.middleware());

// Global admin-only callbacks middleware (restrict inline menus to admins)
const { adminOnlyCallbacks } = require("./src/middlewares/menu-ownership");
bot.use(adminOnlyCallbacks());

// ============================================================================
// FEATURE MODULES - Register
// ============================================================================

// Core: Reputation (calculates tier first)
if (features.isEnabled('userReputation')) {
    userReputation.init(db);
    userReputation.register(bot);
}

// Core: Global Blacklist (early intercept for banned users)
if (features.isEnabled('globalBlacklist')) {
    globalBlacklist.init(db);
    globalBlacklist.register(bot);
}

// Core: Staff & Admin
if (features.isEnabled('actionLog')) {
    actionLog.init(db);
    actionLog.register(bot);
}
if (features.isEnabled('staffCoordination')) {
    staffCoordination.init(db);
    staffCoordination.register(bot);
}
if (features.isEnabled('superAdmin')) {
    superAdmin.init(db);
    superAdmin.register(bot);
}

// Detection: Text-based
if (features.isEnabled('wordFilter')) {
    wordFilter.init(db);
    wordFilter.register(bot);
}
if (features.isEnabled('languageFilter')) {
    languageFilter.init(db);
    languageFilter.register(bot);
}
if (features.isEnabled('spamPatterns')) {
    spamPatterns.init(db);
    spamPatterns.register(bot);
}
if (features.isEnabled('linkFilter')) {
    linkFilter.init(db);
    linkFilter.register(bot);
}
if (features.isEnabled('mentionFilter')) {
    mentionFilter.init(db);
    mentionFilter.register(bot);
}

// Detection: Edit monitoring
if (features.isEnabled('editMonitor')) {
    editMonitor.init(db);
    editMonitor.register(bot);
}

// Detection: Media
if (features.isEnabled('mediaFilter')) {
    mediaFilter.init(db);
    mediaFilter.register(bot);
}

// Community moderation
if (features.isEnabled('reportSystem')) {
    reportSystem.init(db);
    reportSystem.register(bot);
}
if (features.isEnabled('welcomeSystem')) {
    welcomeSystem.init(db);
    welcomeSystem.register(bot);
}
if (features.isEnabled('settingsMenu')) {
    settingsMenu.init(db);
    settingsMenu.register(bot);
}


// COMMANDS - Basic
// ============================================================================
const packageJson = require('./package.json');

const sendStartMenu = async (ctx) => {
    // Only work in private chats
    if (ctx.chat.type !== 'private') {
        return;
    }

    const userId = ctx.from.id;
    const userLang = await db.getUserLanguage(userId) || 'en';
    const t = (key, params) => i18n.t(userLang, key, params);

    const keyboard = {
        inline_keyboard: [
            [{ text: t('common.start.buttons.add_group'), url: `https://t.me/${ctx.me.username}?startgroup=true` }],
            [
                { text: t('common.start.buttons.features'), callback_data: 'start_features' },
                { text: t('common.start.buttons.info'), callback_data: 'start_info' }
            ],
            [{ text: t('common.start.buttons.change_language'), callback_data: 'start_change_lang' }],
            [{ text: t('common.start.buttons.channel'), url: 'https://t.me/SafeJoinChannelLog' }]
        ]
    };

    const text = `${t('common.start.greeting')}\n\n${t('common.start.description')}`;

    if (ctx.callbackQuery) {
        return ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' }).catch(() => { });
    } else {
        return ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    }
};

// Language selection menu
const sendLanguageMenu = async (ctx) => {
    const userId = ctx.from.id;
    const currentLang = await db.getUserLanguage(userId) || 'en';
    const t = (key, params) => i18n.t(currentLang, key, params);

    const keyboard = {
        inline_keyboard: [
            [
                { text: currentLang === 'it' ? '🇮🇹 Italiano ✓' : '🇮🇹 Italiano', callback_data: 'start_set_lang:it' },
                { text: currentLang === 'en' ? '🇬🇧 English ✓' : '🇬🇧 English', callback_data: 'start_set_lang:en' }
            ],
            [{ text: t('common.back'), callback_data: 'back_to_start' }]
        ]
    };

    const text = `${t('common.start.language.title')}\n\n${t('common.start.language.subtitle')}`;

    return ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' }).catch(() => { });
};

// Features main menu
const sendFeaturesMenu = async (ctx) => {
    const userId = ctx.from.id;
    const userLang = await db.getUserLanguage(userId) || 'en';
    const t = (key, params) => i18n.t(userLang, key, params);

    const keyboard = {
        inline_keyboard: [
            [{ text: t('common.start.features.categories.moderation'), callback_data: 'start_feat:moderation' }],
            [{ text: t('common.start.features.categories.protection'), callback_data: 'start_feat:protection' }],
            [{ text: t('common.start.features.categories.welcome'), callback_data: 'start_feat:welcome' }],
            [{ text: t('common.start.features.categories.admin'), callback_data: 'start_feat:admin' }],
            [{ text: t('common.back'), callback_data: 'back_to_start' }]
        ]
    };

    const text = `${t('common.start.features.title')}\n\n${t('common.start.features.subtitle')}`;

    return ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' }).catch(() => { });
};

// Features category detail
const sendFeatureCategory = async (ctx, category) => {
    const userId = ctx.from.id;
    const userLang = await db.getUserLanguage(userId) || 'en';
    const t = (key, params) => i18n.t(userLang, key, params);

    const categoryData = {
        moderation: {
            title: t('common.start.features.moderation.title'),
            items: [
                t('common.start.features.moderation.ai'),
                t('common.start.features.moderation.patterns'),
                t('common.start.features.moderation.words'),
                t('common.start.features.moderation.mentions'),
                t('common.start.features.moderation.reports')
            ]
        },
        protection: {
            title: t('common.start.features.protection.title'),
            items: [
                t('common.start.features.protection.links'),
                t('common.start.features.protection.media'),
                t('common.start.features.protection.blacklist'),
                t('common.start.features.protection.antiedit'),
                t('common.start.features.protection.language')
            ]
        },
        welcome: {
            title: t('common.start.features.welcome.title'),
            items: [
                t('common.start.features.welcome.captcha'),
                t('common.start.features.welcome.message'),
                t('common.start.features.welcome.rules'),
                t('common.start.features.welcome.autodelete')
            ]
        },
        admin: {
            title: t('common.start.features.admin.title'),
            items: [
                t('common.start.features.admin.staff'),
                t('common.start.features.admin.logs'),
                t('common.start.features.admin.settings'),
                t('common.start.features.admin.notes')
            ]
        }
    };

    const data = categoryData[category];
    if (!data) return;

    const keyboard = {
        inline_keyboard: [
            [{ text: t('common.back'), callback_data: 'start_features' }]
        ]
    };

    const itemsList = data.items.map(item => `• ${item}`).join('\n');
    const text = `${data.title}\n\n${itemsList}`;

    return ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' }).catch(() => { });
};

// Info menu
const sendInfoMenu = async (ctx) => {
    const userId = ctx.from.id;
    const userLang = await db.getUserLanguage(userId) || 'en';
    const t = (key, params) => i18n.t(userLang, key, params);

    const keyboard = {
        inline_keyboard: [
            [{ text: t('common.back'), callback_data: 'back_to_start' }]
        ]
    };

    const text = `${t('common.start.info.title')}

📦 <b>${t('common.start.info.version')}:</b> ${packageJson.version}
👨‍💻 <b>${t('common.start.info.developer')}:</b> <a href="tg://user?id=1768337867">ЯIPVΛMPIЯΣƬƬӨ</a>
📅 <b>${t('common.start.info.updated')}:</b> 25/12/2025

${t('common.start.info.description')}`;

    return ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }).catch(() => { });
};

bot.command("start", (ctx) => sendStartMenu(ctx));
bot.callbackQuery("back_to_start", async (ctx) => {
    await ctx.answerCallbackQuery();
    return sendStartMenu(ctx);
});

bot.callbackQuery("start_change_lang", async (ctx) => {
    await ctx.answerCallbackQuery();
    return sendLanguageMenu(ctx);
});

bot.callbackQuery(/^start_set_lang:(.+)$/, async (ctx) => {
    const lang = ctx.match[1];
    const userId = ctx.from.id;
    await db.setUserLanguage(userId, lang);
    await ctx.answerCallbackQuery({ text: lang === 'it' ? '✅ Lingua cambiata!' : '✅ Language changed!' });
    return sendLanguageMenu(ctx);
});

bot.callbackQuery("start_features", async (ctx) => {
    await ctx.answerCallbackQuery();
    return sendFeaturesMenu(ctx);
});

bot.callbackQuery(/^start_feat:(.+)$/, async (ctx) => {
    const category = ctx.match[1];
    await ctx.answerCallbackQuery();
    return sendFeatureCategory(ctx, category);
});

bot.callbackQuery("start_info", async (ctx) => {
    await ctx.answerCallbackQuery();
    return sendInfoMenu(ctx);
});

// bot.command("help", async (ctx) => {
//     const guildId = ctx.chat.id;
//     const t = (key, params) => i18n.t(guildId, key, params);
//     let isGroupAdmin = false;

//     // Check admin status if in group
//     if (ctx.chat.type !== 'private') {
//         try {
//             const member = await ctx.getChatMember(ctx.from.id);
//             isGroupAdmin = ['creator', 'administrator'].includes(member.status);
//         } catch (e) { }
//     }

//     let helpText = `${t('common.help.title')}\n\n`;

//     // User commands
//     helpText += `${t('common.help.user_section')}\n`;
//     helpText += `${t('common.help.myflux_cmd')}\n`;
//     helpText += `${t('common.help.tier_cmd')}\n\n`;

//     if (isGroupAdmin) {
//         // Admin commands
//         helpText += `${t('common.help.admin_section')}\n`;
//         helpText += `${t('common.help.settings_cmd')}\n`;
//         helpText += `${t('common.help.settings_desc')}\n\n`;

//         helpText += `${t('common.help.other_commands')}\n`;
//         helpText += `${t('common.help.setstaff_cmd')}\n`;
//         helpText += `${t('common.help.notes_cmd')}\n\n`;

//         helpText += `${t('common.help.moderation_section')}\n`;
//         helpText += `${t('common.help.voteban_trigger')}\n`;
//     }

//     await ctx.reply(helpText, { parse_mode: "Markdown" });
// });

// ============================================================================
// ERROR HANDLER
// ============================================================================
bot.catch((err) => {
    const ctx = err.ctx;
    logger.error(`Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof GrammyError) {
        logger.error(`Error in request: ${e.description}`);
    } else if (e instanceof HttpError) {
        logger.error(`Could not contact Telegram: ${e}`);
    } else {
        logger.error(`Unknown error: ${e}`);
    }
});

// ============================================================================
// START BOT
// ============================================================================
const backup = require('./src/database/backup');

async function start() {
    // Init database
    await db.init();
    logger.info("Database initialized (PostgreSQL)");

    // Init i18n
    i18n.init(db);
    logger.info("i18n initialized");

    // Start backup scheduler
    backup.startScheduler();
    logger.info("Backup scheduler started");

    // Start bot
    logger.info("🚀 Bot avviato...");
    bot.start({ drop_pending_updates: true });
}

start().catch(err => {
    logger.error("Failed to start bot:", err);
    process.exit(1);
});

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================
/**
 * Flag per evitare shutdown multipli
 * @type {boolean}
 */
let isShuttingDown = false;

/**
 * Gestisce lo shutdown pulito del bot.
 * Chiude ordinatamente tutte le connessioni e risorse.
 * 
 * @param {string} signal - Il segnale che ha triggerato lo shutdown
 * @returns {Promise<void>}
 */
async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        logger.warn(`[shutdown] Already shutting down, ignoring ${signal}`);
        return;
    }
    isShuttingDown = true;

    logger.info(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

    const shutdownTimeout = setTimeout(() => {
        logger.error('[shutdown] Shutdown timeout exceeded (30s). Forcing exit.');
        process.exit(1);
    }, 30000);

    try {
        // 1. Stop accepting new updates
        logger.info('[shutdown] Stopping bot polling...');
        await bot.stop();
        logger.info('[shutdown] ✓ Bot stopped');

        // 2. Stop backup scheduler
        logger.info('[shutdown] Stopping backup scheduler...');
        backup.stopScheduler();
        logger.info('[shutdown] ✓ Backup scheduler stopped');

        // 3. Close database connections
        logger.info('[shutdown] Closing database connections...');
        await db.close();
        logger.info('[shutdown] ✓ Database closed');

        clearTimeout(shutdownTimeout);
        logger.info('👋 Graceful shutdown completed. Goodbye!');
        process.exit(0);
    } catch (err) {
        clearTimeout(shutdownTimeout);
        logger.error(`[shutdown] Error during shutdown: ${err.message}`);
        process.exit(1);
    }
}

// Handle termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    logger.error(`[FATAL] Uncaught Exception: ${err.message}`);
    logger.error(err.stack);
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error(`[FATAL] Unhandled Rejection at: ${promise}`);
    logger.error(`Reason: ${reason}`);
    // Non forzare lo shutdown per unhandled rejection, solo log
});

