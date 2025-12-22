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
    const { id, username, first_name, last_name, is_bot, language_code } = userInfo;
    await query(
        `
        INSERT INTO users (user_id, username, first_name, last_name, is_bot, language_code, last_seen)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
            username = EXCLUDED.username,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            language_code = EXCLUDED.language_code,
            last_seen = NOW()
    `,
        [id, username, first_name, last_name, is_bot || false, language_code]
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
    const rows = await query('SELECT user_id FROM users WHERE is_banned_global = TRUE');
    return rows.map(r => r.user_id);
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

module.exports = {
    getUser,
    upsertUser,
    setUserGlobalBan,
    getGloballyBannedUsers,
    isUserGloballyBanned
};
