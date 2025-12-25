/**
 * @fileoverview Modulo Action Log - Sistema di logging centralizzato
 * @module features/action-log
 *
 * @description
 * Sistema centralizzato per il logging di tutte le azioni di moderazione
 * eseguite dal bot. Supporta logging granulare per tipo di evento
 * e può inviare i log sia a un canale dedicato che a topic specifici.
 *
 * Tipi di eventi supportati:
 * - *_delete: Messaggi eliminati
 * - *_ban: Utenti bannati
 * - *_scam: Tentativi di scam rilevati
 * - *_dismiss: Segnalazioni ignorate
 *
 * @requires ./core - Logica principale di logging
 * @requires ./commands - Handler callback UI
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
}

/**
 * Registra tutti gli handler del modulo sul bot.
 *
 * @param {import('grammy').Bot} bot - Istanza del bot grammY
 */
function register(bot) {
    // Inizializza la logica core con bot e db
    core.init(bot, db);

    // Registra gli handler dei comandi
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
    getLogEvent: () => core.logEvent,
    sendConfigUI
};
