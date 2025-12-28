/**
 * @fileoverview Modulo Global Blacklist - Blacklist globale con CAS
 * @module features/global-blacklist
 *
 * @description
 * Sistema di blacklist globale integrato con Combot Anti-Spam (CAS).
 * Sincronizza la lista ban CAS e verifica ogni messaggio contro di essa.
 * Supporta anche ban globali interni gestiti dal Parliament.
 *
 * Funzionalità:
 * - Sincronizzazione giornaliera con CAS
 * - Verifica utenti in tempo reale
 * - Sincronizzazione ban globali interni
 * - Notifiche configurabili
 *
 * @requires ./sync - Sincronizzazione con CAS
 * @requires ./detection - Verifica ban
 * @requires ./actions - Azioni su utenti bannati
 * @requires ./ui - Interfaccia di configurazione
 */

const sync = require('./sync');
const detection = require('./detection');
const actions = require('./actions');
const ui = require('./ui');
const logger = require('../../middlewares/logger');

/**
 * Riferimento al database
 * @type {Object|null}
 * @private
 */
let db = null;

/**
 * Istanza del bot
 * @type {import('grammy').Bot|null}
 * @private
 */
let _botInstance = null;

/**
 * Intervallo di sincronizzazione: 1 ora in millisecondi
 * @constant {number}
 */
const SYNC_INTERVAL_MS = 1 * 60 * 60 * 1000;

/**
 * Inizializza il modulo con il database.
 *
 * @param {Object} database - Istanza del database PostgreSQL
 */
function init(database) {
    db = database;
    detection.init(database);
}

/**
 * Registra tutti gli handler del modulo sul bot.
 * Include middleware per controllo CAS, comandi admin e sync schedulato.
 *
 * @param {import('grammy').Bot} bot - Istanza del bot grammY
 */
function register(bot) {
    _botInstance = bot;

    // Inizializza sotto-moduli che necessitano del bot
    sync.init(db, bot);
    actions.init(db, bot);

    // Middleware per controllo gban (CAS + local) su ogni messaggio
    bot.on('message', async (ctx, next) => {
        // Skip chat private
        if (ctx.chat.type === 'private') return next();

        // Verifica se abilitato per questo gruppo
        const config = await db.getGuildConfig(ctx.chat.id);
        if (!config.blacklist_enabled) return next();

        // Verifica se l'utente è globalmente bannato (CAS + local gban)
        const gbanResult = await detection.isGloballyBanned(ctx.from.id);
        if (gbanResult.banned) {
            await actions.handleCasBan(ctx, gbanResult.source);
            return; // Stop processing, utente bannato
        }

        return next();
    });

    // Comando super admin per sync manuale
    bot.command('cassync', async ctx => {
        const { isSuperAdmin } = require('../../utils/error-handlers');
        if (!isSuperAdmin(ctx.from.id)) {
            return ctx.reply('❌ Solo super admin possono usare questo comando.');
        }

        await ctx.reply('🔄 Avvio sincronizzazione CAS...');
        const result = await sync.syncCasBans();
        await ctx.reply(result.message);
    });

    // Handler callback
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
            const newState = !config.blacklist_enabled;
            await db.updateGuildConfig(ctx.chat.id, { blacklist_enabled: newState ? 1 : 0 });

            await ui.sendConfigUI(ctx, db, true, fromSettings);

            // Quando si abilita, sincronizza ban globali interni in background
            if (newState) {
                const syncMsg = await ctx.reply('🔄 Sincronizzazione blacklist globale in corso...');

                (async () => {
                    try {
                        const superAdmin = require('../super-admin');
                        const result = await superAdmin.syncGlobalBansToGuild(ctx.chat.id);

                        logger.info(
                            `[global-blacklist] Blacklist sync to ${ctx.chat.id}: ${result.success} internal gbans applied`
                        );

                        try {
                            await ctx.api.deleteMessage(ctx.chat.id, syncMsg.message_id);
                        } catch (e) { }

                        const completeMsg = await ctx.reply(
                            `✅ Sincronizzazione completata: ${result.success} utenti bannati.`
                        );

                        setTimeout(async () => {
                            try {
                                await ctx.api.deleteMessage(ctx.chat.id, completeMsg.message_id);
                            } catch (e) { }
                        }, 10000);
                    } catch (e) {
                        logger.error(`[global-blacklist] Sync failed: ${e.message}`);
                    }
                })();

                setTimeout(async () => {
                    try {
                        await ctx.api.deleteMessage(ctx.chat.id, syncMsg.message_id);
                    } catch (e) { }
                }, 30000);
            }

            await ctx.answerCallbackQuery();
            return;
        }

        if (data === 'cas_notify') {
            const newState = !config.blacklist_notify;
            await db.updateGuildConfig(ctx.chat.id, { blacklist_notify: newState ? 1 : 0 });
            await ui.sendConfigUI(ctx, db, true, fromSettings);
            return;
        }

        await next();
    });

    // Schedula sync giornaliero
    scheduleSync();

    logger.info('[global-blacklist] Module registered');
}

/**
 * Sync local gbans to all groups at startup
 * Bans all users with is_banned_global = TRUE from all groups with blacklist enabled
 * @private
 */
async function syncLocalGbans() {
    try {
        // Get all locally gbanned users
        const bannedUsers = await db.queryAll('SELECT user_id FROM users WHERE is_banned_global = TRUE');
        if (bannedUsers.length === 0) {
            logger.info('[global-blacklist] No local gbans to sync');
            return;
        }

        // Get all guilds with blacklist enabled
        const guilds = await db.queryAll('SELECT guild_id FROM guild_config WHERE blacklist_enabled = true');
        if (guilds.length === 0) {
            logger.info('[global-blacklist] No guilds with blacklist enabled');
            return;
        }

        logger.info(`[global-blacklist] Syncing ${bannedUsers.length} local gbans to ${guilds.length} groups...`);

        let totalBanned = 0;
        let totalFailed = 0;

        for (const user of bannedUsers) {
            for (const guild of guilds) {
                try {
                    await _botInstance.api.banChatMember(guild.guild_id, user.user_id);
                    totalBanned++;
                } catch (e) {
                    // User not in chat or already banned - ok
                    totalFailed++;
                }
            }
            // Small delay to avoid rate limits
            if (bannedUsers.indexOf(user) % 10 === 9) {
                await new Promise(r => setTimeout(r, 100));
            }
        }

        logger.info(`[global-blacklist] Local gban sync completed: ${totalBanned} bans applied, ${totalFailed} skipped`);
    } catch (e) {
        logger.error(`[global-blacklist] Local gban sync failed: ${e.message}`);
    }
}

/**
 * Schedula sincronizzazione periodica con CAS.
 * Esegue sync iniziale dopo 5 secondi, poi ogni 24 ore.
 * @private
 */
function scheduleSync() {
    // Sync iniziale dopo 5 secondi
    setTimeout(async () => {
        logger.info('[global-blacklist] Running initial CAS sync...');
        await sync.syncCasBans();

        // Sync local gbans after CAS sync
        logger.info('[global-blacklist] Running initial local gban sync...');
        await syncLocalGbans();
    }, 5000);

    // Sync ricorrente ogni 1 ora
    setInterval(async () => {
        logger.info('[global-blacklist] Running scheduled CAS sync...');
        await sync.syncCasBans();
    }, SYNC_INTERVAL_MS);

    logger.info('[global-blacklist] Scheduled hourly sync');
}

/**
 * Mostra l'interfaccia di configurazione del modulo.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @param {boolean} [isEdit=false] - Se modificare il messaggio esistente
 * @param {boolean} [fromSettings=false] - Se chiamato dal menu settings
 * @returns {Promise<void>}
 */
function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    init,
    register,
    sendConfigUI,
    /** Forza sync CAS (per testing) */
    forceSync: () => sync.syncCasBans()
};
