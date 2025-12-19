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
const modalPatterns = require("./src/features/modal-patterns");
const linkMonitor = require("./src/features/link-monitor");
const nsfwMonitor = require("./src/features/nsfw-monitor");
const visualImmuneSystem = require("./src/features/visual-immune-system");
const voteBan = require("./src/features/vote-ban");
const settingsMenu = require("./src/features/settings-menu");

// ============================================================================
// DATABASE INIT
// ============================================================================
const db = require("./src/database");

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
keywordMonitor.register(bot, db);
languageMonitor.register(bot, db);
modalPatterns.register(bot, db);
linkMonitor.register(bot, db);
aiModeration.register(bot, db);

// Detection: Edit monitoring
antiEditAbuse.register(bot, db);

// Detection: New user profiling
intelligentProfiler.register(bot, db);

// Detection: Media
nsfwMonitor.register(bot, db);
visualImmuneSystem.register(bot, db);

// Community moderation
voteBan.register(bot, db);
settingsMenu.register(bot, db);

// ============================================================================
// COMMANDS - Basic
// ============================================================================
// COMMANDS - Basic
// ============================================================================
bot.command("start", (ctx) => ctx.reply(
    "👋 Ciao! Sono il bot di moderazione.\n\n" +
    "Uso /help per vedere i comandi disponibili o /settings per il pannello di controllo."
));

bot.command("help", async (ctx) => {
    let isGroupAdmin = false;

    // Check admin status if in group
    if (ctx.chat.type !== 'private') {
        try {
            const member = await ctx.getChatMember(ctx.from.id);
            isGroupAdmin = ['creator', 'administrator'].includes(member.status);
        } catch (e) { }
    } else {
        // In private chat, maybe checking if user is "global admin" (super admin)?
        // For now, let's assume private chat users don't see group config commands 
        // unless we later implement a "select group" flow.
        // BUT, if they are testing in private, they might want to see commands.
        // For safety, only show admin commands in groups where they are admin.
    }

    let helpText = "📚 **COMANDI DISPONIBILI**\n\n";
    helpText += "👤 **Utente:**\n";
    helpText += "/myflux - Vedi il tuo TrustFlux e Tier\n\n";

    if (isGroupAdmin) {
        helpText += "⚙️ **Admin Gruppo:**\n";
        helpText += "/settings - 🎛️ **PANNELLO DI CONTROLLO** (Consigliato)\n\n";
        helpText += "Comandi diretti:\n";
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

    // Start bot
    logger.info("🚀 Bot avviato...");
    bot.start();
}

start().catch(err => {
    logger.error("Failed to start bot:", err);
    process.exit(1);
});
