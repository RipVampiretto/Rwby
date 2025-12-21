const { query, queryOne } = require('./connection');
const logger = require('../middlewares/logger');

/**
 * Run database migrations (PostgreSQL)
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

    const migrations = [
        // Add migrations here as needed
        // { name: 'add_some_column', up: async () => { await query('ALTER TABLE...'); } }
        {
            name: 'add_nsfw_blocked_categories',
            up: async () => {
                await query(`
                    ALTER TABLE guild_config 
                    ADD COLUMN IF NOT EXISTS nsfw_blocked_categories JSONB 
                    DEFAULT '["real_nudity","real_sex","hentai","gore","minors"]'::jsonb
                `);
            }
        }
    ];

    for (const migration of migrations) {
        const existing = await queryOne('SELECT * FROM migrations WHERE name = $1', [migration.name]);
        if (!existing) {
            logger.info(`[migrations] Running: ${migration.name}`);
            try {
                await migration.up();
                await query('INSERT INTO migrations (name) VALUES ($1)', [migration.name]);
                logger.info(`[migrations] Completed: ${migration.name}`);
            } catch (err) {
                logger.error(`[migrations] Failed: ${migration.name} - ${err.message}`);
                throw err;
            }
        }
    }

    logger.info('[migrations] All migrations applied');
}

module.exports = {
    runMigrations
};
