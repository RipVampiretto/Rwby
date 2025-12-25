/**
 * @fileoverview Modulo Spam Patterns - Rilevamento spam basato su pattern
 * @module features/spam-patterns
 *
 * @description
 * Sistema di pattern globali organizzati per lingua e categoria.
 * I pattern ("modal") vengono gestiti centralmente dal Parliament
 * e applicati a tutti i gruppi per rilevare spam, scam e contenuti indesiderati.
 *
 * Funzionalità:
 * - Pattern organizzati per lingua (IT, EN, RU, etc.)
 * - Categorie configurabili (spam, scam, adult, crypto, etc.)
 * - Azioni per pattern (delete, warn, ban)
 * - Cache in memoria per performance
 *
 * @requires ./logic - Logica di matching e cache
 * @requires ./commands - Handler comandi
 * @requires ./manage - API gestione pattern (SuperAdmin)
 * @requires ./ui - Interfaccia di configurazione
 */

const logic = require('./logic');
const commands = require('./commands');
const manage = require('./manage');
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
    manage.init(database);
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
    sendConfigUI,
    // Export SuperAdmin API per gestione pattern
    listModals: manage.listModals,
    getModal: manage.getModal,
    upsertModal: manage.upsertModal,
    addPatternsToModal: manage.addPatternsToModal,
    removePatternsFromModal: manage.removePatternsFromModal,
    deleteModal: manage.deleteModal,
    toggleModal: manage.toggleModal,
    toggleModalHidden: manage.toggleModalHidden,
    updateModalAction: manage.updateModalAction,
    refreshCache: logic.refreshCache
};
