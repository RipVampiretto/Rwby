const { query } = require('./connection');
const logger = require('../middlewares/logger');

/**
 * Run database migrations (PostgreSQL)
 * NOTE: All main schema definitions are now in schema.js
 * This file is kept for future schema evolutions.
 */
async function runMigrations() {
    // Create migrations tracking table if not exists
    await query(`
        CREATE TABLE IF NOT EXISTS migrations (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            applied_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    logger.info('[migrations] Schema is up to date (consolidated)');
}

module.exports = {
    runMigrations
};
