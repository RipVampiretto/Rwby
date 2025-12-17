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
const linkMonitor = require("./src/features/link-monitor");
const nsfwMonitor = require("./src/features/nsfw-monitor");
const visualImmuneSystem = require("./src/features/visual-immune-system");
const voteBan = require("./src/features/vote-ban");

// ============================================================================
// DATABASE INIT
// ============================================================================
const db = require("./src/database");

// ============================================================================
// GLOBAL MIDDLEWARE - Logging
// ============================================================================
bot.use(async (ctx, next) => {
    const user = ctx.from?.first_name || 'System';
    const text = ctx.message?.text?.substring(0, 50) || 'Non-text update';
    logger.info(`[${user}] ${text}`);
    await next();
});

// ============================================================================
// FEATURE MODULES - Register
// ============================================================================
// Ordine di registrazione middleware (importante!):
// 1. userReputation - Calcola tier prima di tutto
// 2. Detection modules - Controllano contenuti
// 3. Action handlers - Gestiscono risposte

// Core: Reputation (deve essere primo per calcolare tier)
userReputation.register(bot, db);

// Core: Staff & Admin
adminLogger.register(bot, db);
staffCoordination.register(bot, db);
superAdmin.register(bot, db);
intelNetwork.register(bot, db);

// Detection: Text-based
antiSpam.register(bot, db);
aiModeration.register(bot, db);
keywordMonitor.register(bot, db);
languageMonitor.register(bot, db);
linkMonitor.register(bot, db);

// Detection: Edit monitoring
antiEditAbuse.register(bot, db);

// Detection: New user profiling
intelligentProfiler.register(bot, db);

// Detection: Media
nsfwMonitor.register(bot, db);
visualImmuneSystem.register(bot, db);

// Community moderation
voteBan.register(bot, db);

// ============================================================================
// COMMANDS - Basic
// ============================================================================
bot.command("start", (ctx) => ctx.reply(
    "👋 Ciao! Sono il bot di moderazione.\n\n" +
    "Uso /help per vedere i comandi disponibili."
));

bot.command("help", (ctx) => {
    const isGroupAdmin = ctx.isAdmin; // Set by isAdmin middleware if re-added

    let helpText = "📚 **COMANDI DISPONIBILI**\n\n";
    helpText += "👤 **Utente:**\n";
    helpText += "/myflux - Vedi il tuo TrustFlux e Tier\n\n";

    if (isGroupAdmin) {
        helpText += "⚙️ **Admin Gruppo:**\n";
        helpText += "/spamconfig - Configura anti-spam\n";
        helpText += "/aiconfig - Configura AI moderation\n";
        helpText += "/editconfig - Configura anti-edit abuse\n";
        helpText += "/profilerconfig - Configura profiler nuovi utenti\n";
        helpText += "/wordconfig - Gestisci parole vietate\n";
        helpText += "/langconfig - Configura filtro lingua\n";
        helpText += "/linkconfig - Gestisci whitelist/blacklist link\n";
        helpText += "/nsfwconfig - Configura filtro NSFW\n";
        helpText += "/visualconfig - Configura visual immune system\n";
        helpText += "/voteconfig - Configura vote ban\n";
        helpText += "/logconfig - Configura logging\n";
        helpText += "/setstaff - Imposta gruppo staff\n";
        helpText += "/intel - Status Intel Network\n";
    }

    ctx.reply(helpText, { parse_mode: "Markdown" });
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

    // Start bot
    logger.info("🚀 Bot avviato...");
    bot.start();
}

start().catch(err => {
    logger.error("Failed to start bot:", err);
    process.exit(1);
});
