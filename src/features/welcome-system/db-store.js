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
 * @returns {Promise<void>}
 */
async function addPendingCaptcha(guildId, userId, messageId, answer, timeoutMinutes, options = []) {
    const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000);
    const optionsJson = JSON.stringify(options);

    await query(
        `INSERT INTO pending_captchas (guild_id, user_id, message_id, correct_answer, options, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`, // ID is serial, unlikely conflict. Logic should prevent double insert per user usually
        [guildId, userId, messageId, answer, optionsJson, expiresAt]
    );
}

/**
 * Recupera un captcha in sospeso per un utente in un gruppo.
 * @param {bigint} guildId
 * @param {bigint} userId
 * @returns {Promise<Object|null>}
 */
async function getPendingCaptcha(guildId, userId) {
    const res = await query(
        `SELECT * FROM pending_captchas WHERE guild_id = $1 AND user_id = $2 LIMIT 1`,
        [guildId, userId]
    );
    return res.rows[0] || null;
}

/**
 * Rimuove un captcha dal database (risolto o utente uscito).
 * @param {bigint} guildId
 * @param {bigint} userId
 * @returns {Promise<void>}
 */
async function removePendingCaptcha(guildId, userId) {
    await query(
        `DELETE FROM pending_captchas WHERE guild_id = $1 AND user_id = $2`,
        [guildId, userId]
    );
}

/**
 * Recupera tutti i captcha scaduti.
 * @returns {Promise<Array>}
 */
async function getExpiredCaptchas() {
    const res = await query(
        `SELECT * FROM pending_captchas WHERE expires_at < NOW()`
    );
    return res.rows;
}

/**
 * Rimuove un captcha tramite ID (usato dopo aver processato la scadenza).
 * @param {number} id - ID riga tabella
 * @returns {Promise<void>}
 */
async function removeCaptchaById(id) {
    await query(
        `DELETE FROM pending_captchas WHERE id = $1`,
        [id]
    );
}

module.exports = {
    addPendingCaptcha,
    getPendingCaptcha,
    removePendingCaptcha,
    getExpiredCaptchas,
    removeCaptchaById
};
