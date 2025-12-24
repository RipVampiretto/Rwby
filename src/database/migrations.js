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

    // Migration: Add edit_grace_period and edit_action columns
    const migration1 = 'add_edit_grace_period';
    const check1 = await query(`SELECT 1 FROM migrations WHERE name = $1`, [migration1]);
    if (check1.rowCount === 0) {
        try {
            await query(`ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS edit_grace_period INTEGER DEFAULT 0`);
            await query(`ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS edit_action TEXT DEFAULT 'delete'`);
            await query(`INSERT INTO migrations (name) VALUES ($1)`, [migration1]);
            logger.info(`[migrations] Applied: ${migration1}`);
        } catch (e) {
            logger.debug(`[migrations] ${migration1} already applied or failed: ${e.message}`);
        }
    }

    // Migration: Add report_action_hate column (replacing spam)
    const migration2 = 'add_report_action_hate';
    const check2 = await query(`SELECT 1 FROM migrations WHERE name = $1`, [migration2]);
    if (check2.rowCount === 0) {
        try {
            await query(
                `ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS report_action_hate TEXT DEFAULT 'report_only'`
            );
            await query(`INSERT INTO migrations (name) VALUES ($1)`, [migration2]);
            logger.info(`[migrations] Applied: ${migration2}`);
        } catch (e) {
            logger.debug(`[migrations] ${migration2} already applied or failed: ${e.message}`);
        }
    }

    // Migration: Add keyword_enabled column
    const migration3 = 'add_keyword_enabled';
    const check3 = await query(`SELECT 1 FROM migrations WHERE name = $1`, [migration3]);
    if (check3.rowCount === 0) {
        try {
            await query(`ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS keyword_enabled BOOLEAN DEFAULT FALSE`);
            await query(`INSERT INTO migrations (name) VALUES ($1)`, [migration3]);
            logger.info(`[migrations] Applied: ${migration3}`);
        } catch (e) {
            logger.debug(`[migrations] ${migration3} already applied or failed: ${e.message}`);
        }
    }

    // Migration: Add casban_notify column
    const migration4 = 'add_casban_notify';
    const check4 = await query(`SELECT 1 FROM migrations WHERE name = $1`, [migration4]);
    if (check4.rowCount === 0) {
        try {
            await query(`ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS casban_notify BOOLEAN DEFAULT FALSE`);
            await query(`INSERT INTO migrations (name) VALUES ($1)`, [migration4]);
            logger.info(`[migrations] Applied: ${migration4}`);
        } catch (e) {
            logger.debug(`[migrations] ${migration4} already applied or failed: ${e.message}`);
        }
    }

    logger.info('[migrations] Schema is up to date');
}

module.exports = {
    runMigrations
};
