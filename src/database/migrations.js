const logger = require('../middlewares/logger');

/**
 * Run database migrations
 * @param {object} db - Database instance
 */
function runMigrations(db) {
    // ========================================================================
    // MIGRATIONS - Add new columns to existing tables
    // ========================================================================

    // Modal Pattern System columns
    const modalColumns = [
        { name: 'modal_enabled', def: 'INTEGER DEFAULT 1' },
        { name: 'modal_action', def: "TEXT DEFAULT 'report_only'" },
        { name: 'modal_sync_global', def: 'INTEGER DEFAULT 1' },
        { name: 'modal_tier_bypass', def: 'INTEGER DEFAULT 2' }
    ];

    for (const col of modalColumns) {
        try {
            db.exec(`ALTER TABLE guild_config ADD COLUMN ${col.name} ${col.def}`);
            logger.info(`[database] Added column ${col.name} to guild_config`);
        } catch (e) {
            // Column already exists, ignore
        }
    }

    // UI Language column
    try {
        db.exec(`ALTER TABLE guild_config ADD COLUMN ui_language TEXT DEFAULT 'en'`);
        logger.info(`[database] Added column ui_language to guild_config`);
    } catch (e) {
        // Column already exists, ignore
    }

    // AI Tier Bypass column
    try {
        db.exec(`ALTER TABLE guild_config ADD COLUMN ai_tier_bypass INTEGER DEFAULT 2`);
        logger.info(`[database] Added column ai_tier_bypass to guild_config`);
    } catch (e) {
        // Column already exists, ignore
    }

    // Edit Tier Bypass column
    try {
        db.exec(`ALTER TABLE guild_config ADD COLUMN edit_tier_bypass INTEGER DEFAULT 2`);
        logger.info(`[database] Added column edit_tier_bypass to guild_config`);
    } catch (e) {
        // Column already exists, ignore
    }

    // Welcome System columns
    const welcomeColumns = [
        { name: 'welcome_enabled', def: 'INTEGER DEFAULT 0' }, // Legacy/Master?
        { name: 'welcome_msg_enabled', def: 'INTEGER DEFAULT 0' },
        { name: 'welcome_message', def: 'TEXT' },
        { name: 'welcome_buttons', def: 'TEXT' },
        { name: 'captcha_mode', def: "TEXT DEFAULT 'button'" },
        { name: 'captcha_enabled', def: 'INTEGER DEFAULT 0' },
        { name: 'kick_timeout', def: 'INTEGER DEFAULT 5' },
        { name: 'welcome_autodelete_timer', def: 'INTEGER DEFAULT 0' },
        { name: 'rules_enabled', def: 'INTEGER DEFAULT 0' },
        { name: 'rules_link', def: 'TEXT' },
        { name: 'captcha_logs_enabled', def: 'INTEGER DEFAULT 0' }
    ];

    for (const col of welcomeColumns) {
        try {
            db.exec(`ALTER TABLE guild_config ADD COLUMN ${col.name} ${col.def}`);
            logger.info(`[database] Added column ${col.name} to guild_config`);
        } catch (e) {
            // Column already exists, ignore
        }
    }
}

module.exports = {
    runMigrations
};
