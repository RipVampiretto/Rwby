require('dotenv').config();
const { Bot, GrammyError, HttpError } = require("grammy");
const logger = require("./src/middlewares/logger");

// ============================================================================
// INIT BOT
// ============================================================================
const bot = new Bot(process.env.BOT_TOKEN);

// ============================================================================
// FEATURE MODULES - Import
// ============================================================================
// Core modules (ordine importante: prima i moduli base, poi quelli che dipendono)
const userReputation = require("./src/features/user-reputation");
const casBan = require("./src/features/cas-ban");
const adminLogger = require("./src/features/admin-logger");
const staffCoordination = require("./src/features/staff-coordination");
const superAdmin = require("./src/features/super-admin");
const intelNetwork = require("./src/features/intel-network");

// Detection modules
const antiSpam = require("./src/features/anti-spam");
const aiModeration = require("./src/features/ai-moderation");
const antiEditAbuse = require("./src/features/anti-edit-abuse");
const intelligentProfiler = require("./src/features/intelligent-profiler");
const keywordMonitor = require("./src/features/keyword-monitor");
const languageMonitor = require("./src/features/language-monitor");
const modalPatterns = require("./src/features/modal-patterns");
const linkMonitor = require("./src/features/link-monitor");
const nsfwMonitor = require("./src/features/nsfw-monitor");
const visualImmuneSystem = require("./src/features/visual-immune-system");
const voteBan = require("./src/features/vote-ban");
const welcomeSystem = require("./src/features/welcome-system");
const settingsMenu = require("./src/features/settings-menu");

// ============================================================================
// DATABASE INIT
// ============================================================================
const db = require("./src/database");
const i18n = require("./src/i18n");

// ============================================================================
// GLOBAL MIDDLEWARE - Logging & User Cache
// ============================================================================
bot.use(async (ctx, next) => {
    // Cache user info
    if (ctx.from) {
        db.upsertUser(ctx.from);
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
// Ordine di registrazione middleware (importante!):
// 1. userReputation - Calcola tier prima di tutto
// 2. Detection modules - Controllano contenuti
// 3. Action handlers - Gestiscono risposte

// Core: Reputation (deve essere primo per calcolare tier)
userReputation.register(bot, db);

// Core: CAS Ban (early intercept for banned users)
casBan.register(bot, db);

// Core: Staff & Admin
adminLogger.register(bot, db);
staffCoordination.register(bot, db);
superAdmin.register(bot, db);
// intelNetwork.register(bot, db); // DISABLED

// Detection: Text-based
// antiSpam.register(bot, db); // DISABLED
keywordMonitor.register(bot, db);
languageMonitor.register(bot, db);
modalPatterns.register(bot, db);
linkMonitor.register(bot, db);
aiModeration.register(bot, db);

// Detection: Edit monitoring
antiEditAbuse.register(bot, db);

// Detection: New user profiling
// intelligentProfiler.register(bot, db); // DISABLED

// Detection: Media
nsfwMonitor.register(bot, db);
visualImmuneSystem.register(bot, db);

// Community moderation
voteBan.register(bot, db);
welcomeSystem.register(bot, db);
settingsMenu.register(bot, db);

// COMMANDS - Basic
// ============================================================================
bot.command("start", (ctx) => {
    const guildId = ctx.chat.id;
    const t = (key, params) => i18n.t(guildId, key, params);
    ctx.reply(
        `${t('common.start.greeting')}\n\n` +
        `${t('common.start.instructions')}`
    );
});

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
async function start() {
    // Init database
    await db.init();
    logger.info("Database initialized");

    // Init i18n
    i18n.init(db);
    logger.info("i18n initialized");

    // Start bot
    logger.info("🚀 Bot avviato...");
    bot.start();
}

start().catch(err => {
    logger.error("Failed to start bot:", err);
    process.exit(1);
});
