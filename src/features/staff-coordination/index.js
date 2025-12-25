/**
 * @fileoverview Modulo Staff Coordination - Coordinamento staff del gruppo
 * @module features/staff-coordination
 *
 * @description
 * Sistema per la coordinazione dello staff del gruppo.
 * Supporta gruppi staff separati con topic per diverse funzioni,
 * coda di revisione e wizard per la configurazione.
 *
 * Funzionalità:
 * - Configurazione gruppo staff separato
 * - Topic per logs, reports, votazioni
 * - Coda di revisione intelligente
 * - Wizard interattivo per setup
 *
 * @requires ./commands - Handler comandi
 * @requires ./logic - Logica coordinamento
 * @requires ./ui - Interfaccia di configurazione
 * @requires ./wizard - Wizard configurazione
 */

const commands = require('./commands');
const logic = require('./logic');
const ui = require('./ui');
const wizard = require('./wizard');
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
 * Inizializza il modulo con il database.
 *
 * @param {Object} database - Istanza del database PostgreSQL
 */
function init(database) {
    db = database;
}

/**
 * Registra tutti gli handler del modulo sul bot.
 *
 * @param {import('grammy').Bot} bot - Istanza del bot grammY
 */
function register(bot) {
    _botInstance = bot;
    commands.registerCommands(bot, db);
    logger.info('[staff-coordination] Module registered');

    // Callback per Wizard e Eliminazione
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (data.startsWith('stf_wizard:') || data.startsWith('stf_del:') || data === 'stf_cancel') {
            if (db) return logic.handleCallback(ctx, db);
        }
        return next();
    });

    // Listener messaggi per Wizard
    bot.on('message:text', async (ctx, next) => {
        const handled = await wizard.handleMessage(ctx);
        if (handled) return;
        return next();
    });
}

/**
 * Accoda un messaggio alla coda di revisione staff.
 *
 * @param {Object} params - Parametri per la revisione
 * @returns {Promise<void>}
 */
function reviewQueue(params) {
    return logic.reviewQueue(_botInstance, db, params);
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
    if (!db) {
        logger.warn('[staff-coordination] DB is null during sendConfigUI call');
        return ctx.answerCallbackQuery('⚠️ Staff module not initialized (disabled?).');
    }
    logger.debug('[staff-coordination] calling ui.sendConfigUI');
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    init,
    register,
    reviewQueue,
    sendConfigUI
};
