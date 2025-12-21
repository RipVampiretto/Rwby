// ============================================================================
// CAS BAN MODULE - Global User Blacklist (Combot Anti-Spam Integration)
// ============================================================================
// SCOPO: Sincronizza lista ban CAS e verifica ogni messaggio contro di essa.
// ============================================================================

const sync = require('./sync');
const detection = require('./detection');
const actions = require('./actions');
const ui = require('./ui');
const logger = require('../../middlewares/logger');

let db = null;
let _botInstance = null;

// Sync interval: 24 hours in milliseconds
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Initialize sub-modules
    sync.init(database, bot);
    detection.init(database);
    actions.init(database, bot);

    // Register message middleware for CAS checking
    bot.on('message', async (ctx, next) => {
        // Skip private chats
        if (ctx.chat.type === 'private') return next();

        // Check if enabled for this guild
        const config = db.getGuildConfig(ctx.chat.id);
        if (config.casban_enabled === 0) return next();

        // Check if user is CAS banned
        const isBanned = await detection.isCasBanned(ctx.from.id);
        if (isBanned) {
            await actions.handleCasBan(ctx);
            return; // Stop processing, user is banned
        }

        return next();
    });

    // Register super admin command for manual sync
    bot.command('cassync', async (ctx) => {
        const { isSuperAdmin } = require('../../utils/error-handlers');
        if (!isSuperAdmin(ctx.from.id)) {
            return ctx.reply('❌ Solo super admin possono usare questo comando.');
        }

        await ctx.reply('🔄 Avvio sincronizzazione CAS...');
        const result = await sync.syncCasBans();
        await ctx.reply(result.message);
    });

    // Register callback handlers
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith('cas_')) return next();

        const config = db.getGuildConfig(ctx.chat.id);
        const fromSettings = ctx.callbackQuery.message?.reply_markup?.inline_keyboard?.some(
            row => row.some(btn => btn.callback_data === 'settings_main')
        );

        if (data === 'cas_close') {
            await ctx.deleteMessage();
            return;
        }

        if (data === 'cas_toggle') {
            const newState = config.casban_enabled === 0 ? 1 : 0;
            await db.updateGuildConfig(ctx.chat.id, { casban_enabled: newState });

            // When enabling, sync all existing internal global bans to this group
            if (newState === 1) {
                await ctx.answerCallbackQuery({ text: '🔄 Sincronizzazione blacklist in corso...' });

                const superAdmin = require('../super-admin');
                const result = await superAdmin.syncGlobalBansToGuild(ctx.chat.id);

                logger.info(`[cas-ban] Blacklist sync to ${ctx.chat.id}: ${result.success} internal gbans applied`);
            }

            await ui.sendConfigUI(ctx, db, true, fromSettings);
            return;
        }

        await next();
    });

    // Schedule daily sync
    scheduleSync();

    logger.info('[cas-ban] Module registered');
}

function scheduleSync() {
    // Initial sync after 5 seconds (give bot time to start)
    setTimeout(async () => {
        logger.info('[cas-ban] Running initial CAS sync...');
        await sync.syncCasBans();
    }, 5000);

    // Schedule recurring sync every 24 hours
    setInterval(async () => {
        logger.info('[cas-ban] Running scheduled CAS sync...');
        await sync.syncCasBans();
    }, SYNC_INTERVAL_MS);

    logger.info('[cas-ban] Scheduled daily sync');
}

function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    register,
    sendConfigUI,
    // Expose for testing
    forceSync: () => sync.syncCasBans()
};
