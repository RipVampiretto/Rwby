/**
 * @fileoverview Modulo Language Filter - Rilevamento e enforcement lingua
 * @module features/language-filter
 *
 * @description
 * Sistema di controllo lingua per i messaggi.
 * Rileva la lingua di ogni messaggio e applica le restrizioni
 * configurate per il gruppo (lingue permesse/vietate).
 *
 * @requires ./commands - Handler comandi e logica rilevamento
 * @requires ./ui - Interfaccia di configurazione
 */

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
 * @returns {Promise<void>}
 */
function sendConfigUI(ctx, isEdit = false) {
    return ui.sendConfigUI(ctx, db, isEdit);
}

module.exports = {
    init,
    register,
    sendConfigUI
};
