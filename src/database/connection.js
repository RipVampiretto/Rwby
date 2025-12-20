const sqlite3 = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('../middlewares/logger');

let db = null;

/**
 * Initialize database connection
 * @returns {Promise<object>} Database instance
 */
async function init() {
    const dbPath = process.env.DB_PATH || path.join('data/bot.db');

    // Ensure data directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    db = sqlite3(dbPath);
    db.pragma('journal_mode = WAL'); // Better performance

    logger.info(`Database connected: ${dbPath}`);
    return db;
}

/**
 * Get database instance
 */
function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call init() first.');
    }
    return db;
}

module.exports = {
    init,
    getDb
};
