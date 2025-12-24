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

function init(database) {
    db = database;
    // Initialize detection which only needs db
    detection.init(database);
}

function register(bot) {
    _botInstance = bot;

    // Initialize sub-modules that need bot
    sync.init(db, bot);
    actions.init(db, bot);

    // Register message middleware for CAS checking
    bot.on('message', async (ctx, next) => {
        // Skip private chats
        if (ctx.chat.type === 'private') return next();

        // Check if enabled for this guild
        const config = await db.getGuildConfig(ctx.chat.id);
        if (!config.casban_enabled) return next();

        // Check if user is CAS banned
        const isBanned = await detection.isCasBanned(ctx.from.id);
        if (isBanned) {
            await actions.handleCasBan(ctx);
            return; // Stop processing, user is banned
        }

        return next();
    });

    // Register super admin command for manual sync
    bot.command('cassync', async ctx => {
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

        const config = await db.getGuildConfig(ctx.chat.id);
        const fromSettings = ctx.callbackQuery.message?.reply_markup?.inline_keyboard?.some(row =>
            row.some(btn => btn.callback_data === 'settings_main')
        );

        if (data === 'cas_close') {
            await ctx.deleteMessage();
            return;
        }

        if (data === 'cas_toggle') {
            const newState = !config.casban_enabled;
            await db.updateGuildConfig(ctx.chat.id, { casban_enabled: newState ? 1 : 0 });

            // Update UI immediately
            await ui.sendConfigUI(ctx, db, true, fromSettings);

            // When enabling, sync all existing internal global bans to this group (in background)
            if (newState) {
                // Send sync start message (will be deleted after 30s)
                const syncMsg = await ctx.reply('🔄 Sincronizzazione blacklist globale in corso...');

                // Run sync in background
                (async () => {
                    try {
                        const superAdmin = require('../super-admin');
                        const result = await superAdmin.syncGlobalBansToGuild(ctx.chat.id);

                        logger.info(
                            `[global-blacklist] Blacklist sync to ${ctx.chat.id}: ${result.success} internal gbans applied`
                        );

                        // Delete sync start message
                        try {
                            await ctx.api.deleteMessage(ctx.chat.id, syncMsg.message_id);
                        } catch (e) {}

                        // Send completion message
                        const completeMsg = await ctx.reply(
                            `✅ Sincronizzazione completata: ${result.success} utenti bannati.`
                        );

                        // Auto-delete after 10s
                        setTimeout(async () => {
                            try {
                                await ctx.api.deleteMessage(ctx.chat.id, completeMsg.message_id);
                            } catch (e) {}
                        }, 10000);
                    } catch (e) {
                        logger.error(`[global-blacklist] Sync failed: ${e.message}`);
                    }
                })();

                // Auto-delete sync message after 30s if still exists
                setTimeout(async () => {
                    try {
                        await ctx.api.deleteMessage(ctx.chat.id, syncMsg.message_id);
                    } catch (e) {}
                }, 30000);
            }

            await ctx.answerCallbackQuery();
            return;
        }

        if (data === 'cas_notify') {
            const newState = !config.casban_notify;
            await db.updateGuildConfig(ctx.chat.id, { casban_notify: newState ? 1 : 0 });
            await ui.sendConfigUI(ctx, db, true, fromSettings);
            return;
        }

        await next();
    });

    // Schedule daily sync
    scheduleSync();

    logger.info('[global-blacklist] Module registered');
}

function scheduleSync() {
    // Initial sync after 5 seconds (give bot time to start)
    setTimeout(async () => {
        logger.info('[global-blacklist] Running initial CAS sync...');
        await sync.syncCasBans();
    }, 5000);

    // Schedule recurring sync every 24 hours
    setInterval(async () => {
        logger.info('[global-blacklist] Running scheduled CAS sync...');
        await sync.syncCasBans();
    }, SYNC_INTERVAL_MS);

    logger.info('[global-blacklist] Scheduled daily sync');
}

function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    init,
    register,
    sendConfigUI,
    // Expose for testing
    forceSync: () => sync.syncCasBans()
};
