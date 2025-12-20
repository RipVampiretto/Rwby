const { getDb } = require('../connection');

/**
 * Get or create user in cache
 * @param {number} userId - The user ID to retrieve
 */
function getUser(userId) {
    const db = getDb();
    return db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
}

/**
 * Update or insert user info (called on every message to keep cache fresh)
 * @param {object} userInfo - User information object
 */
function upsertUser(userInfo) {
    const db = getDb();
    const { id, username, first_name, last_name, is_bot, language_code } = userInfo;
    db.prepare(`
        INSERT INTO users (user_id, username, first_name, last_name, is_bot, language_code, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
            username = ?,
            first_name = ?,
            last_name = ?,
            language_code = ?,
            last_seen = CURRENT_TIMESTAMP
    `).run(id, username, first_name, last_name, is_bot ? 1 : 0, language_code,
        username, first_name, last_name, language_code);
}

/**
 * Mark user as globally banned
 * @param {number} userId - The user ID
 * @param {boolean} isBanned - Ban status
 */
function setUserGlobalBan(userId, isBanned) {
    const db = getDb();
    db.prepare('UPDATE users SET is_banned_global = ? WHERE user_id = ?').run(isBanned ? 1 : 0, userId);
}

module.exports = {
    getUser,
    upsertUser,
    setUserGlobalBan
};
