/**
 * @fileoverview Modulo User Reputation - Sistema Flux e Tier
 * @module features/user-reputation
 *
 * @description
 * Sistema di reputazione utente basato su "Flux" (punti fiducia).
 * Gli utenti accumulano Flux partecipando attivamente ai gruppi
 * e progrediscono attraverso i Tier che sbloccano privilegi.
 *
 * **Sistema Tier:**
 * - Tier 0 (🌑 Ombra): 0-99 Flux - Massime restrizioni
 * - Tier 1 (⚔️ Scudiero): 100-299 Flux - Restrizioni moderate
 * - Tier 2 (🛡️ Guardiano): 300-499 Flux - Poche restrizioni
 * - Tier 3 (👁️ Sentinella): 500+ Flux - Minime restrizioni
 *
 * **Acquisizione Flux:**
 * - +1 per messaggio (max ogni 6 minuti)
 * - +5 per captcha completato
 * - Bonus per attività costante
 *
 * **Perdita Flux:**
 * - -10 per warning
 * - -50 per contenuto NSFW
 * - -100 per spam/scam
 *
 * @requires ./logic - Calcoli Tier e gestione Flux
 * @requires ./commands - Handler comandi
 */

const commands = require('./commands');
const logic = require('./logic');
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
    commands.registerCommands(bot, db);
    logger.info('[user-reputation] Module registered');
}

/**
 * Ottiene il Tier corrente di un utente in un gruppo.
 *
 * @param {number} userId - ID dell'utente Telegram
 * @param {number} guildId - ID del gruppo
 * @returns {Promise<number>} Tier 0-3
 */
function getUserTier(userId, guildId) {
    return logic.getUserTier(db, userId, guildId);
}

/**
 * Ottiene il Flux locale di un utente in un gruppo specifico.
 *
 * @param {number} userId - ID dell'utente
 * @param {number} guildId - ID del gruppo
 * @returns {Promise<number>} Flux locale
 */
function getLocalFlux(userId, guildId) {
    return logic.getLocalFlux(db, userId, guildId);
}

/**
 * Ottiene il Flux globale di un utente (somma di tutti i gruppi).
 *
 * @param {number} userId - ID dell'utente
 * @returns {Promise<number>} Flux globale
 */
function getGlobalFlux(userId) {
    return logic.getGlobalFlux(db, userId);
}

/**
 * Modifica il Flux di un utente (positivo o negativo).
 *
 * @param {number} userId - ID dell'utente
 * @param {number} guildId - ID del gruppo
 * @param {number} delta - Variazione (positiva o negativa)
 * @param {string} reason - Motivo della modifica
 * @returns {Promise<void>}
 */
function modifyFlux(userId, guildId, delta, reason) {
    return logic.modifyFlux(db, userId, guildId, delta, reason);
}

module.exports = {
    init,
    register,
    getUserTier,
    getLocalFlux,
    getGlobalFlux,
    modifyFlux
};
