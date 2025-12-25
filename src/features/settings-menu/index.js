/**
 * @fileoverview Modulo Settings Menu - Menu impostazioni principale
 * @module features/settings-menu
 *
 * @description
 * Menu principale per le impostazioni del bot nei gruppi.
 * Aggrega tutti i moduli e fornisce un'interfaccia unificata
 * per la configurazione.
 *
 * @requires ./commands - Handler comandi e callback
 * @requires ./ui - Generazione interfacce
 */

const commands = require('./commands');
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
    ui.setDb(database); // Passa db alla UI per controllo gruppo staff
}

/**
 * Registra tutti gli handler del modulo sul bot.
 *
 * @param {import('grammy').Bot} bot - Istanza del bot grammY
 */
function register(bot) {
    _botInstance = bot;
    commands.registerCommands(bot, db);
    logger.info('[settings-menu] Module registered');
}

module.exports = {
    init,
    register
};
