/**
 * @fileoverview Modulo Link Filter - Controllo link e URL
 * @module features/link-filter
 *
 * @description
 * Sistema di controllo dei link nei messaggi con whitelist/blacklist
 * di domini gestite a livello globale (Parliament).
 *
 * Funzionalità:
 * - Estrazione link da entità Telegram e regex
 * - Rilevamento domini senza protocollo (es. palla.com)
 * - Controllo whitelist/blacklist globale
 * - Inoltro domini sconosciuti al Parliament per revisione
 *
 * @requires ./logic - Logica estrazione e controllo link
 * @requires ./actions - Azioni dopo il rilevamento
 * @requires ./commands - Handler comandi e callback
 * @requires ./ui - Interfaccia di configurazione
 */

const logic = require('./logic');
const actions = require('./actions');
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
    actions.init(database);
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
