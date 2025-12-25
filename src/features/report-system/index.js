/**
 * @fileoverview Modulo Report System - Sistema di segnalazioni
 * @module features/report-system
 *
 * @description
 * Sistema per gestire le segnalazioni degli utenti.
 * Supporta votazioni comunitarie per azioni di moderazione
 * e integrazione con lo staff del gruppo.
 *
 * Funzionalità:
 * - Segnalazione messaggi/utenti
 * - Votazioni comunitarie
 * - Notifiche allo staff
 * - Scadenza automatica voti
 *
 * @requires ./commands - Handler comandi e callback
 * @requires ./actions - Gestione votazioni e azioni
 * @requires ./ui - Interfaccia di configurazione
 */

const commands = require('./commands');
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

    // Pulizia periodica voti scaduti (ogni minuto)
    setInterval(() => actions.processExpiredVotes(bot, db), 60000);

    commands.registerCommands(bot, db);
    logger.info('[report-system] Module registered');
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
    sendConfigUI
};
