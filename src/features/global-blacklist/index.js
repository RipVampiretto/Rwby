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
 * Intervallo di sincronizzazione: 24 ore in millisecondi
 * @constant {number}
 */
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

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

    // Middleware per controllo CAS su ogni messaggio
    bot.on('message', async (ctx, next) => {
        // Skip chat private
        if (ctx.chat.type === 'private') return next();

        // Verifica se abilitato per questo gruppo
        const config = await db.getGuildConfig(ctx.chat.id);
        if (!config.blacklist_enabled) return next();

        // Verifica se l'utente è bannato da CAS
        const isBanned = await detection.isCasBanned(ctx.from.id);
        if (isBanned) {
            await actions.handleCasBan(ctx);
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
 * Schedula sincronizzazione periodica con CAS.
 * Esegue sync iniziale dopo 5 secondi, poi ogni 24 ore.
 * @private
 */
function scheduleSync() {
    // Sync iniziale dopo 5 secondi
    setTimeout(async () => {
        logger.info('[global-blacklist] Running initial CAS sync...');
        await sync.syncCasBans();
    }, 5000);

    // Sync ricorrente ogni 24 ore
    setInterval(async () => {
        logger.info('[global-blacklist] Running scheduled CAS sync...');
        await sync.syncCasBans();
    }, SYNC_INTERVAL_MS);

    logger.info('[global-blacklist] Scheduled daily sync');
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
