/**
 * @fileoverview Punto di ingresso del modulo Database
 * @module database
 *
 * @description
 * Facciata per l'accesso al database PostgreSQL.
 * Inizializza la connessione, crea le tabelle e aggrega
 * le funzioni dei repository per un accesso centralizzato.
 *
 * @requires ./connection - Gestione pool connessioni
 * @requires ./schema - Definizione e creazione tabelle
 * @requires ./repos/user - Repository utenti
 * @requires ./repos/guild - Repository gruppi
 */

const connection = require('./connection');
const schema = require('./schema');
const userRepo = require('./repos/user');
const guildRepo = require('./repos/guild');

/**
 * Inizializza la connessione al database e crea le tabelle.
 *
 * @returns {Promise<import('pg').Pool>} Pool di connessioni PostgreSQL
 */
async function init() {
    // Inizializza il pool di connessioni
    await connection.init();

    // Crea le tabelle se non esistono
    await schema.createTables();

    return connection.getPool();
}

module.exports = {
    init,
    getPool: connection.getPool,
    /** Wrapper compatibilità per codice legacy */
    getDb: connection.getDb,
    query: connection.query,
    queryOne: connection.queryOne,
    queryAll: connection.queryAll,

    // ----- User Repository -----
    /** @see module:database/repos/user.getUser */
    getUser: userRepo.getUser,
    /** @see module:database/repos/user.upsertUser */
    upsertUser: userRepo.upsertUser,
    /** @see module:database/repos/user.setUserGlobalBan */
    setUserGlobalBan: userRepo.setUserGlobalBan,
    /** @see module:database/repos/user.getGloballyBannedUsers */
    getGloballyBannedUsers: userRepo.getGloballyBannedUsers,
    /** @see module:database/repos/user.isUserGloballyBanned */
    isUserGloballyBanned: userRepo.isUserGloballyBanned,
    /** @see module:database/repos/user.getUserLanguage */
    getUserLanguage: userRepo.getUserLanguage,
    /** @see module:database/repos/user.setUserLanguage */
    setUserLanguage: userRepo.setUserLanguage,

    // ----- Guild Repository -----
    /** @see module:database/repos/guild.getGuildConfig */
    getGuildConfig: guildRepo.getGuildConfig,
    /** @see module:database/repos/guild.fetchGuildConfig */
    fetchGuildConfig: guildRepo.fetchGuildConfig,
    /** @see module:database/repos/guild.updateGuildConfig */
    updateGuildConfig: guildRepo.updateGuildConfig,
    /** @see module:database/repos/guild.upsertGuild */
    upsertGuild: guildRepo.upsertGuild
};
