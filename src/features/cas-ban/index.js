// ============================================================================
// CAS BAN MODULE - Combot Anti-Spam Integration
// ============================================================================
// SCOPO: Sincronizza lista ban CAS e verifica ogni messaggio contro di essa.
// ============================================================================

const sync = require('./sync');
const detection = require('./detection');
const actions = require('./actions');
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

        // Check if user is CAS banned
        const isBanned = detection.isCasBanned(ctx.from.id);
        if (isBanned) {
            await actions.handleCasBan(ctx);
            return; // Stop processing, user is banned
        }

        return next();
    });

    // Register admin command for manual sync
    bot.command('cassync', async (ctx) => {
        // Check if admin
        if (ctx.chat.type === 'private') {
            // Check if super admin
            const superAdminIds = (process.env.SUPER_ADMIN_IDS || '').split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
            if (!superAdminIds.includes(ctx.from.id)) {
                return ctx.reply('❌ Solo super admin possono usare questo comando.');
            }
        } else {
            try {
                const member = await ctx.getChatMember(ctx.from.id);
                if (!['creator', 'administrator'].includes(member.status)) {
                    return ctx.reply('❌ Solo admin possono usare questo comando.');
                }
            } catch (e) {
                return ctx.reply('❌ Errore verifica permessi.');
            }
        }

        await ctx.reply('🔄 Avvio sincronizzazione CAS...');
        const result = await sync.syncCasBans();
        await ctx.reply(result.message);
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

module.exports = {
    register,
    // Expose for testing
    forceSync: () => sync.syncCasBans()
};
