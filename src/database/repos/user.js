/**
 * @fileoverview Repository per la gestione degli utenti
 * @module database/repos/user
 *
 * @description
 * Fornisce funzioni per la gestione degli utenti nel database.
 * Gestisce cache utenti, ban globali e preferenze lingua.
 */

const { queryOne, query } = require('../connection');

/**
 * Ottiene un utente dalla cache.
 *
 * @param {number} userId - ID dell'utente
 * @returns {Promise<Object|null>} Utente o null se non trovato
 */
async function getUser(userId) {
    return await queryOne('SELECT * FROM users WHERE user_id = $1', [userId]);
}

/**
 * Aggiorna o inserisce le informazioni di un utente.
 * Chiamata ad ogni messaggio per mantenere la cache aggiornata.
 *
 * @param {Object} userInfo - Informazioni utente da Telegram
 * @param {number} userInfo.id - ID utente
 * @param {string} [userInfo.username] - Username
 * @param {string} [userInfo.first_name] - Nome
 * @param {string} [userInfo.last_name] - Cognome
 * @param {string} [userInfo.language_code] - Codice lingua
 * @returns {Promise<void>}
 */
async function upsertUser(userInfo) {
    const { id, username, first_name, last_name, language_code } = userInfo;
    await query(
        `
        INSERT INTO users (user_id, username, first_name, last_name, language_code, last_seen)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
            username = EXCLUDED.username,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            language_code = EXCLUDED.language_code,
            last_seen = NOW()
    `,
        [id, username, first_name, last_name, language_code]
    );
}

/**
 * Imposta lo stato di ban globale di un utente.
 *
 * @param {number} userId - ID utente
 * @param {boolean} isBanned - Stato ban
 * @returns {Promise<void>}
 */
async function setUserGlobalBan(userId, isBanned) {
    await query('UPDATE users SET is_banned_global = $1 WHERE user_id = $2', [isBanned, userId]);
}

/**
 * Ottiene tutti gli ID degli utenti bannati globalmente.
 *
 * @returns {Promise<number[]>} Array di ID utenti
 */
async function getGloballyBannedUsers() {
    const result = await query('SELECT user_id FROM users WHERE is_banned_global = TRUE');
    return (result.rows || []).map(r => r.user_id);
}

/**
 * Verifica se un utente è bannato globalmente.
 *
 * @param {number} userId - ID utente
 * @returns {Promise<boolean>} True se bannato
 */
async function isUserGloballyBanned(userId) {
    const user = await queryOne('SELECT is_banned_global FROM users WHERE user_id = $1', [userId]);
    return user?.is_banned_global === true;
}

/**
 * Ottiene la lingua preferita di un utente.
 *
 * @param {number} userId - ID utente
 * @returns {Promise<string|null>} Codice lingua o null
 */
async function getUserLanguage(userId) {
    const user = await queryOne('SELECT preferred_language FROM users WHERE user_id = $1', [userId]);
    return user?.preferred_language || null;
}

/**
 * Imposta la lingua preferita di un utente.
 *
 * @param {number} userId - ID utente
 * @param {string} language - Codice lingua (es. 'en', 'it')
 * @returns {Promise<void>}
 */
async function setUserLanguage(userId, language) {
    await query(
        `INSERT INTO users (user_id, preferred_language) 
         VALUES ($1, $2) 
         ON CONFLICT (user_id) DO UPDATE SET preferred_language = $2`,
        [userId, language]
    );
}

module.exports = {
    getUser,
    upsertUser,
    setUserGlobalBan,
    getGloballyBannedUsers,
    isUserGloballyBanned,
    getUserLanguage,
    setUserLanguage
};
