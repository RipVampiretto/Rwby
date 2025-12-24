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
        await db.upsertGuild(ctx.chat);

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

    // Log message
    const user = ctx.from?.first_name || 'System';
    const text = ctx.message?.text?.substring(0, 50) || 'Non-text update';
    logger.info(`[${user}] ${text}`);
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
const sendStartMenu = (ctx) => {
    const guildId = ctx.chat.id;
    const t = (key, params) => i18n.t(guildId, key, params);

    const keyboard = {
        inline_keyboard: [
            [{ text: t('common.start.buttons.add_group'), url: `https://t.me/${ctx.me.username}?startgroup=true` }],
            [
                { text: t('common.start.buttons.my_flux'), callback_data: "my_flux_overview" },
                { text: t('common.start.buttons.tier_info'), callback_data: "tier_explainer" }
            ]
        ]
    };

    const text = `${t('common.start.greeting')}\n\n${t('common.start.instructions')}`;

    if (ctx.callbackQuery) {
        return ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => { });
    } else {
        return ctx.reply(text, { reply_markup: keyboard });
    }
};

bot.command("start", (ctx) => sendStartMenu(ctx));
bot.callbackQuery("back_to_start", (ctx) => sendStartMenu(ctx));

bot.command("help", async (ctx) => {
    const guildId = ctx.chat.id;
    const t = (key, params) => i18n.t(guildId, key, params);
    let isGroupAdmin = false;

    // Check admin status if in group
    if (ctx.chat.type !== 'private') {
        try {
            const member = await ctx.getChatMember(ctx.from.id);
            isGroupAdmin = ['creator', 'administrator'].includes(member.status);
        } catch (e) { }
    }

    let helpText = `${t('common.help.title')}\n\n`;

    // User commands
    helpText += `${t('common.help.user_section')}\n`;
    helpText += `${t('common.help.myflux_cmd')}\n`;
    helpText += `${t('common.help.tier_cmd')}\n\n`;

    if (isGroupAdmin) {
        // Admin commands
        helpText += `${t('common.help.admin_section')}\n`;
        helpText += `${t('common.help.settings_cmd')}\n`;
        helpText += `${t('common.help.settings_desc')}\n\n`;

        helpText += `${t('common.help.other_commands')}\n`;
        helpText += `${t('common.help.setstaff_cmd')}\n`;
        helpText += `${t('common.help.notes_cmd')}\n\n`;

        helpText += `${t('common.help.moderation_section')}\n`;
        helpText += `${t('common.help.voteban_trigger')}\n`;
    }

    await ctx.reply(helpText, { parse_mode: "Markdown" });
});

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

