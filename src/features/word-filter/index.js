/**
 * @fileoverview Modulo Word Filter - Filtro parole/frasi vietate
 * @module features/word-filter
 *
 * @description
 * Sistema di filtraggio per parole e frasi vietate gestite globalmente.
 * I pattern vengono gestiti dal Parliament e applicati a tutti i gruppi.
 *
 * @requires ./logic - Logica di matching pattern
 * @requires ./commands - Handler comandi
 * @requires ./ui - Interfaccia di configurazione
 */

const logic = require('./logic');
const commands = require('./commands');
const ui = require('./ui');

/**
 * Riferimento al database
 * @type {Object|null}
 * @private
 */
let db = null;

/**
 * Inizializza il modulo con il database.
 *
 * @param {Object} database - Istanza del database PostgreSQL
 */
function init(database) {
    db = database;
    logic.init(database);
}

/**
 * Registra tutti gli handler del modulo sul bot.
 *
 * @param {import('grammy').Bot} bot - Istanza del bot grammY
 */
function register(bot) {
    commands.registerCommands(bot, db);
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
