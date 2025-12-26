/**
 * @fileoverview Modulo Super Admin - Gestione centralizzata Parliament
 * @module features/super-admin
 *
 * @description
 * Sistema di amministrazione centralizzata per i super admin.
 * Gestisce il "Parliament" (gruppo centrale) dove confluiscono
 * tutte le segnalazioni e i log di tutti i gruppi gestiti.
 *
 * Funzionalità:
 * - Forward contenuti sospetti al Parliament
 * - Log globali di tutti i gruppi
 * - Sincronizzazione ban globali
 * - Notifica nuovi gruppi
 * - Pulizia automatica contenuti pendenti
 *
 * @requires ./commands - Handler comandi super admin
 * @requires ./logic - Logica core Parliament
 */

const commands = require('./commands');
const logic = require('./logic');
const logger = require('../../middlewares/logger');
const { createMessageCounter } = require('../analytics/message-counter');

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

    // Message counter for analytics (runs async, doesn't block)
    bot.use(createMessageCounter(db));

    // Cron per pulizia eliminazioni pendenti (ogni ora)
    setInterval(() => logic.cleanupPendingDeletions(db, bot), 3600000);

    commands.registerCommands(bot, db);
    logger.info('[super-admin] Module registered');
}

/**
 * Inoltra contenuto testuale al Parliament.
 *
 * @param {Object} params - Parametri per l'inoltro
 * @param {string} params.topic - Topic di destinazione
 * @param {string} params.text - Testo da inviare
 * @param {Object} [params.keyboard] - Tastiera inline opzionale
 * @returns {Promise<void>}
 */
function forwardToParliament(params) {
    return logic.forwardToParliament(_botInstance, db, params);
}

/**
 * Inoltra un media al Parliament.
 *
 * @param {string} topic - Topic di destinazione
 * @param {import('grammy').Context} ctx - Contesto con il media
 * @param {string} caption - Didascalia
 * @param {Object} [customKeyboard] - Tastiera inline opzionale
 * @returns {Promise<void>}
 */
function forwardMediaToParliament(topic, ctx, caption, customKeyboard) {
    return logic.forwardMediaToParliament(_botInstance, db, topic, ctx, caption, customKeyboard);
}

/**
 * Inoltra un album di media al Parliament.
 *
 * @param {string} topic - Topic di destinazione
 * @param {Array} violations - Array di violazioni rilevate
 * @param {Object} info - Informazioni sull'album
 * @returns {Promise<void>}
 */
function forwardAlbumToParliament(topic, violations, info) {
    return logic.forwardAlbumToParliament(_botInstance, db, topic, violations, info);
}

/**
 * Invia un evento al log globale.
 *
 * @param {Object} event - Evento da loggare
 * @param {string} event.eventType - Tipo di evento
 * @param {number} event.guildId - ID del gruppo
 * @param {string} event.executor - Esecutore dell'azione
 * @param {string} event.target - Target dell'azione
 * @param {string} [event.reason] - Motivo
 * @param {string} [event.details] - Dettagli aggiuntivi
 * @returns {Promise<void>}
 */
function sendGlobalLog(event) {
    return logic.sendGlobalLog(_botInstance, db, event);
}

/**
 * Sincronizza i ban globali interni a un gruppo specifico.
 *
 * @param {number} guildId - ID del gruppo
 * @returns {Promise<{success: number}>} Risultato della sincronizzazione
 */
function syncGlobalBansToGuild(guildId) {
    return logic.syncGlobalBansToGuild(_botInstance, db, guildId);
}

/**
 * Notifica al Parliament l'aggiunta di un nuovo gruppo.
 *
 * @param {number} guildId - ID del nuovo gruppo
 * @param {string} guildName - Nome del nuovo gruppo
 * @returns {Promise<void>}
 */
function notifyNewGroup(guildId, guildName) {
    return logic.notifyNewGroup(_botInstance, db, guildId, guildName);
}

module.exports = {
    init,
    register,
    forwardToParliament,
    forwardMediaToParliament,
    forwardAlbumToParliament,
    sendGlobalLog,
    syncGlobalBansToGuild,
    notifyNewGroup
};
