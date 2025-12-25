/**
 * @fileoverview Modulo Mention Filter - Rilevamento scam tramite menzioni
 * @module features/mention-filter
 *
 * @description
 * Sistema di rilevamento scam basato sulle menzioni di utenti esterni.
 * Quando un utente menziona @username esterni al gruppo, il sistema
 * utilizza AI per classificare potenziali tentativi di scam/recruitment.
 *
 * Funzionalità:
 * - Rilevamento menzioni di utenti non nel gruppo
 * - Analisi AI del contesto per identificare scam
 * - Azioni automatiche (delete, warn, ban)
 * - Logging dettagliato
 *
 * @requires ./logic - Logica di rilevamento scam
 * @requires ./actions - Azioni post-rilevamento
 * @requires ./commands - Handler comandi
 * @requires ./ui - Interfaccia di configurazione
 */

const logic = require('./logic');
const actions = require('./actions');
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
 * Inizializza il modulo con il database.
 *
 * @param {Object} database - Istanza del database PostgreSQL
 */
function init(database) {
    db = database;
    logic.init(database);
    actions.init(database);
    logger.info('[mention-filter] Module initialized');
}

/**
 * Registra tutti gli handler del modulo sul bot.
 *
 * @param {import('grammy').Bot} bot - Istanza del bot grammY
 */
function register(bot) {
    commands.registerCommands(bot, db);
    logger.info('[mention-filter] Module registered and ready');
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
