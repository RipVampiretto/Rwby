/**
 * @fileoverview Modulo Edit Monitor - Rilevamento abusi modifica messaggi
 * @module features/edit-monitor
 *
 * @description
 * Sistema per rilevare e prevenire abusi della funzione modifica messaggi.
 * Salva snapshot dei messaggi originali e confronta le modifiche
 * per identificare tentativi di evasione dei filtri.
 *
 * Scenari rilevati:
 * - Messaggi innocui modificati in spam dopo l'approvazione
 * - Inserimento link/spam dopo il controllo iniziale
 * - Modifica contenuti per aggiungere promozioni
 *
 * @requires ./core - Gestione snapshot messaggi
 * @requires ./commands - Handler comandi
 * @requires ./ui - Interfaccia di configurazione
 */

const core = require('./core');
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
    // Inizializza core (gestione snapshot)
    core.init(database);
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
