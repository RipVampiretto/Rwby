const { queryOne, query } = require('../connection');

/**
 * Get user from cache
 * @param {number} userId - The user ID to retrieve
 * @returns {Promise<object|null>}
 */
async function getUser(userId) {
    return await queryOne('SELECT * FROM users WHERE user_id = $1', [userId]);
}

/**
 * Update or insert user info (called on every message to keep cache fresh)
 * @param {object} userInfo - User information object
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
 * Mark user as globally banned
 * @param {number} userId - The user ID
 * @param {boolean} isBanned - Ban status
 */
async function setUserGlobalBan(userId, isBanned) {
    await query('UPDATE users SET is_banned_global = $1 WHERE user_id = $2', [isBanned, userId]);
}

/**
 * Get all globally banned user IDs
 * @returns {Promise<Array<number>>} Array of user IDs
 */
async function getGloballyBannedUsers() {
    const result = await query('SELECT user_id FROM users WHERE is_banned_global = TRUE');
    return (result.rows || []).map(r => r.user_id);
}

/**
 * Check if a user is globally banned
 * @param {number} userId - The user ID
 * @returns {Promise<boolean>}
 */
async function isUserGloballyBanned(userId) {
    const user = await queryOne('SELECT is_banned_global FROM users WHERE user_id = $1', [userId]);
    return user?.is_banned_global === true;
}

/**
 * Get user's preferred language
 * @param {number} userId - The user ID
 * @returns {Promise<string|null>}
 */
async function getUserLanguage(userId) {
    const user = await queryOne('SELECT preferred_language FROM users WHERE user_id = $1', [userId]);
    return user?.preferred_language || null;
}

/**
 * Set user's preferred language
 * @param {number} userId - The user ID
 * @param {string} language - Language code (e.g., 'en', 'it')
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
