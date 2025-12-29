/**
 * @fileoverview Helper per le operazioni database del sistema Welcome/Captcha
 * @module features/welcome-system/db-store
 */

const { query } = require('../../database/connection');

/**
 * Salva un nuovo captcha in sospeso nel database.
 * @param {bigint} guildId - ID del gruppo
 * @param {bigint} userId - ID dell'utente
 * @param {number} messageId - ID del messaggio del captcha
 * @param {string} answer - Risposta corretta (da salvare in chiaro o hash se preferito, qui salvo testo)
 * @param {number} timeoutMinutes - Minuti prima della scadenza
 * @param {Array} [options] - Opzioni generate (per button/math/etc)
 * @param {number|null} [serviceMessageId] - ID messaggio di join di servizio
 * @returns {Promise<void>}
 */
async function addPendingCaptcha(
    guildId,
    userId,
    messageId,
    answer,
    timeoutMinutes,
    options = [],
    serviceMessageId = null
) {
    const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000);
    const optionsJson = JSON.stringify(options);

    await query(
        `INSERT INTO pending_captchas (guild_id, user_id, message_id, correct_answer, options, expires_at, service_message_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [guildId, userId, messageId, answer, optionsJson, expiresAt, serviceMessageId]
    );
}

/**
 * Recupera un captcha in sospeso per un utente in un gruppo.
 * @param {bigint} guildId
 * @param {bigint} userId
 * @returns {Promise<Object|null>}
 */
async function getPendingCaptcha(guildId, userId) {
    const res = await query(`SELECT * FROM pending_captchas WHERE guild_id = $1 AND user_id = $2 LIMIT 1`, [
        guildId,
        userId
    ]);
    return res.rows[0] || null;
}

/**
 * Rimuove un captcha dal database (risolto o utente uscito).
 * @param {bigint} guildId
 * @param {bigint} userId
 * @returns {Promise<void>}
 */
async function removePendingCaptcha(guildId, userId) {
    await query(`DELETE FROM pending_captchas WHERE guild_id = $1 AND user_id = $2`, [guildId, userId]);
}

/**
 * Recupera tutti i captcha scaduti.
 * @returns {Promise<Array>}
 */
async function getExpiredCaptchas() {
    const res = await query(`SELECT * FROM pending_captchas WHERE expires_at < NOW()`);
    return res.rows;
}

/**
 * Rimuove un captcha tramite ID (usato dopo aver processato la scadenza).
 * @param {number} id - ID riga tabella
 * @returns {Promise<void>}
 */
async function removeCaptchaById(id) {
    await query(`DELETE FROM pending_captchas WHERE id = $1`, [id]);
}

/**
 * Aggiunge un utente ai verificati recenti.
 */
async function addRecentlyVerified(guildId, userId, welcomeMsgId, serviceMsgId) {
    await query(
        `INSERT INTO recently_verified_users (guild_id, user_id, welcome_message_id, service_message_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, guild_id) DO UPDATE 
         SET welcome_message_id = $3, service_message_id = $4, verified_at = NOW()`,
        [guildId, userId, welcomeMsgId, serviceMsgId]
    );
}

/**
 * Recupera un utente verificato di recente.
 */
async function getRecentlyVerified(guildId, userId) {
    const res = await query(`SELECT * FROM recently_verified_users WHERE guild_id = $1 AND user_id = $2`, [
        guildId,
        userId
    ]);
    return res.rows[0] || null;
}

/**
 * Rimuove un utente dai verificati recenti.
 */
async function removeRecentlyVerified(guildId, userId) {
    await query(`DELETE FROM recently_verified_users WHERE guild_id = $1 AND user_id = $2`, [guildId, userId]);
}

/**
 * Rimuove tutti i record di recently_verified_users più vecchi di X minuti.
 * @param {number} [minutes=5] - Minuti dopo i quali rimuovere i record
 * @returns {Promise<number>} Numero di record rimossi
 */
async function cleanupOldVerifiedUsers(minutes = 5) {
    const res = await query(
        `DELETE FROM recently_verified_users WHERE verified_at < NOW() - INTERVAL '${minutes} minutes'`
    );
    return res.rowCount || 0;
}

/**
 * Aggiorna il service_message_id di un captcha pendente.
 * @param {number} id - ID del record captcha
 * @param {number} serviceMessageId - ID del messaggio di servizio (join)
 * @returns {Promise<void>}
 */
async function updatePendingServiceMessage(id, serviceMessageId) {
    await query(`UPDATE pending_captchas SET service_message_id = $1 WHERE id = $2`, [serviceMessageId, id]);
}

module.exports = {
    addPendingCaptcha,
    getPendingCaptcha,
    removePendingCaptcha,
    getExpiredCaptchas,
    removeCaptchaById,
    addRecentlyVerified,
    getRecentlyVerified,
    removeRecentlyVerified,
    cleanupOldVerifiedUsers,
    updatePendingServiceMessage
};
