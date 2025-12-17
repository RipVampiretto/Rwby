const sqlite3 = require('better-sqlite3');
const path = require('path');
const logger = require('../middlewares/logger');

// ============================================================================
// DATABASE MODULE - SQLite3 with better-sqlite3
// ============================================================================

let db = null;

/**
 * Initialize database connection and create tables
 */
async function init() {
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/bot.db');

    // Ensure data directory exists
    const fs = require('fs');
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    db = sqlite3(dbPath);
    db.pragma('journal_mode = WAL'); // Better performance

    // Create core tables
    createTables();

    logger.info(`Database connected: ${dbPath}`);
    return db;
}

/**
 * Create all required tables
 */
function createTables() {
    // ========================================================================
    // USERS CACHE - User info cache
    // ========================================================================
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            first_name TEXT,
            last_name TEXT,
            is_bot INTEGER DEFAULT 0,
            language_code TEXT,
            first_seen TEXT DEFAULT CURRENT_TIMESTAMP,
            last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
            is_banned_global INTEGER DEFAULT 0
        )
    `);

    // ========================================================================
    // GUILD CONFIG - Per-group settings
    // ========================================================================
    db.exec(`
        CREATE TABLE IF NOT EXISTS guild_config (
            guild_id INTEGER PRIMARY KEY,
            guild_name TEXT,
            
            -- Staff Coordination
            staff_group_id INTEGER,
            staff_topics TEXT DEFAULT '{}',
            
            -- Admin Logger
            log_channel_id INTEGER,
            log_events TEXT DEFAULT '["ban","delete","ai_action"]',
            log_format TEXT DEFAULT 'standard',
            
            -- Anti-Spam
            spam_enabled INTEGER DEFAULT 1,
            spam_sensitivity TEXT DEFAULT 'medium',
            spam_action_volume TEXT DEFAULT 'delete',
            spam_action_repetition TEXT DEFAULT 'delete',
            spam_volume_limit_60s INTEGER DEFAULT 10,
            spam_volume_limit_10s INTEGER DEFAULT 5,
            spam_duplicate_limit INTEGER DEFAULT 3,
            
            -- AI Moderation
            ai_enabled INTEGER DEFAULT 1,
            ai_action_scam TEXT DEFAULT 'ban',
            ai_action_hate TEXT DEFAULT 'report_only',
            ai_action_nsfw TEXT DEFAULT 'delete',
            ai_action_threat TEXT DEFAULT 'report_only',
            ai_action_spam TEXT DEFAULT 'delete',
            ai_confidence_threshold REAL DEFAULT 0.75,
            ai_context_aware INTEGER DEFAULT 1,
            ai_sensitivity TEXT DEFAULT 'medium',
            ai_context_messages INTEGER DEFAULT 3,
            
            -- Anti-Edit Abuse
            edit_monitor_enabled INTEGER DEFAULT 1,
            edit_abuse_action TEXT DEFAULT 'delete',
            edit_lock_tier0 INTEGER DEFAULT 1,
            edit_similarity_threshold REAL DEFAULT 0.5,
            edit_link_injection_action TEXT DEFAULT 'ban',
            
            -- Intelligent Profiler
            profiler_enabled INTEGER DEFAULT 1,
            profiler_action_link TEXT DEFAULT 'delete',
            profiler_action_forward TEXT DEFAULT 'delete',
            profiler_action_pattern TEXT DEFAULT 'report_only',
            
            -- Keyword Monitor
            keyword_sync_global INTEGER DEFAULT 1,
            
            -- Language Monitor
            lang_enabled INTEGER DEFAULT 0,
            allowed_languages TEXT DEFAULT '["en"]',
            lang_action TEXT DEFAULT 'delete',
            lang_min_chars INTEGER DEFAULT 20,
            lang_confidence_threshold REAL DEFAULT 0.8,
            lang_tier_bypass INTEGER DEFAULT 1,
            
            -- Link Monitor
            link_enabled INTEGER DEFAULT 1,
            link_action_unknown TEXT DEFAULT 'report_only',
            link_sync_global INTEGER DEFAULT 1,
            link_tier_bypass INTEGER DEFAULT 1,
            
            -- NSFW Monitor
            nsfw_enabled INTEGER DEFAULT 1,
            nsfw_action TEXT DEFAULT 'delete',
            nsfw_threshold REAL DEFAULT 0.7,
            nsfw_check_photos INTEGER DEFAULT 1,
            nsfw_check_videos INTEGER DEFAULT 1,
            nsfw_check_gifs INTEGER DEFAULT 1,
            nsfw_check_stickers INTEGER DEFAULT 0,
            nsfw_frame_interval_percent INTEGER DEFAULT 5,
            nsfw_tier_bypass INTEGER DEFAULT 3,
            
            -- Visual Immune System
            visual_enabled INTEGER DEFAULT 1,
            visual_action TEXT DEFAULT 'delete',
            visual_sync_global INTEGER DEFAULT 1,
            visual_hamming_threshold INTEGER DEFAULT 5,
            
            -- Vote Ban
            voteban_enabled INTEGER DEFAULT 0,
            voteban_threshold INTEGER DEFAULT 5,
            voteban_duration_minutes INTEGER DEFAULT 30,
            voteban_initiator_tier INTEGER DEFAULT 1,
            voteban_voter_tier INTEGER DEFAULT 0,
            
            -- Metadata
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // ========================================================================
    // USER TRUST FLUX - Per-user per-group reputation
    // ========================================================================
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_trust_flux (
            user_id INTEGER,
            guild_id INTEGER,
            local_flux INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            last_activity TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, guild_id)
        )
    `);

    // ========================================================================
    // USER GLOBAL FLUX - Global reputation
    // ========================================================================
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_global_flux (
            user_id INTEGER PRIMARY KEY,
            global_flux INTEGER DEFAULT 0,
            groups_participated INTEGER DEFAULT 0,
            total_violations INTEGER DEFAULT 0,
            last_sync TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // ========================================================================
    // USER ACTIVE STATS - Real-time spam tracking
    // ========================================================================
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_active_stats (
            user_id INTEGER,
            guild_id INTEGER,
            msg_count_60s INTEGER DEFAULT 0,
            msg_count_10s INTEGER DEFAULT 0,
            last_msg_content TEXT,
            last_msg_ts TEXT,
            duplicate_count INTEGER DEFAULT 0,
            violation_count_24h INTEGER DEFAULT 0,
            last_violation_ts TEXT,
            PRIMARY KEY (user_id, guild_id)
        )
    `);

    // ========================================================================
    // MESSAGE SNAPSHOTS - For edit abuse detection
    // ========================================================================
    db.exec(`
        CREATE TABLE IF NOT EXISTS message_snapshots (
            message_id INTEGER,
            chat_id INTEGER,
            user_id INTEGER,
            original_text TEXT,
            original_has_link INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            edit_count INTEGER DEFAULT 0,
            PRIMARY KEY (message_id, chat_id)
        )
    `);

    // ========================================================================
    // WORD FILTERS - Keyword blacklist
    // ========================================================================
    db.exec(`
        CREATE TABLE IF NOT EXISTS word_filters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id INTEGER DEFAULT 0,
            word TEXT NOT NULL,
            is_regex INTEGER DEFAULT 0,
            action TEXT DEFAULT 'delete',
            category TEXT DEFAULT 'custom',
            severity INTEGER DEFAULT 1,
            match_whole_word INTEGER DEFAULT 0,
            bypass_tier INTEGER DEFAULT 2,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // ========================================================================
    // LINK RULES - Whitelist/Blacklist
    // ========================================================================
    db.exec(`
        CREATE TABLE IF NOT EXISTS link_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id INTEGER DEFAULT 0,
            pattern TEXT NOT NULL,
            type TEXT NOT NULL,
            action TEXT DEFAULT 'delete',
            category TEXT,
            added_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // ========================================================================
    // VISUAL HASHES - Image fingerprints
    // ========================================================================
    db.exec(`
        CREATE TABLE IF NOT EXISTS visual_hashes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phash TEXT NOT NULL,
            type TEXT DEFAULT 'ban',
            category TEXT,
            guild_id INTEGER DEFAULT 0,
            added_by INTEGER,
            match_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // ========================================================================
    // ACTIVE VOTES - Community vote ban
    // ========================================================================
    db.exec(`
        CREATE TABLE IF NOT EXISTS active_votes (
            vote_id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_user_id INTEGER,
            target_username TEXT,
            chat_id INTEGER,
            poll_message_id INTEGER,
            initiated_by INTEGER,
            reason TEXT,
            votes_yes INTEGER DEFAULT 0,
            votes_no INTEGER DEFAULT 0,
            required_votes INTEGER,
            voters TEXT DEFAULT '[]',
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            expires_at TEXT
        )
    `);

    // ========================================================================
    // GLOBAL NOTES - Notes on users
    // ========================================================================
    db.exec(`
        CREATE TABLE IF NOT EXISTS global_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            guild_id INTEGER,
            note_text TEXT,
            severity TEXT DEFAULT 'info',
            created_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            is_global INTEGER DEFAULT 0
        )
    `);

    // ========================================================================
    // INTEL DATA - Federated intelligence
    // ========================================================================
    db.exec(`
        CREATE TABLE IF NOT EXISTS intel_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            value TEXT NOT NULL,
            metadata TEXT DEFAULT '{}',
            added_by_guild INTEGER,
            added_by_user INTEGER,
            trust_weight INTEGER DEFAULT 50,
            confirmations INTEGER DEFAULT 0,
            reports INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // ========================================================================
    // GUILD TRUST - Network trust scores
    // ========================================================================
    db.exec(`
        CREATE TABLE IF NOT EXISTS guild_trust (
            guild_id INTEGER PRIMARY KEY,
            guild_name TEXT,
            tier INTEGER DEFAULT 0,
            trust_score INTEGER DEFAULT 50,
            contributions_valid INTEGER DEFAULT 0,
            contributions_invalid INTEGER DEFAULT 0,
            joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
            last_sync TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // ========================================================================
    // GLOBAL CONFIG - SuperAdmin settings
    // ========================================================================
    db.exec(`
        CREATE TABLE IF NOT EXISTS global_config (
            id INTEGER PRIMARY KEY DEFAULT 1,
            parliament_group_id INTEGER,
            global_topics TEXT DEFAULT '{}',
            global_log_channel INTEGER,
            network_mode TEXT DEFAULT 'normal'
        )
    `);

    // ========================================================================
    // PENDING DELETIONS - Auto-delete after 24h
    // ========================================================================
    db.exec(`
        CREATE TABLE IF NOT EXISTS pending_deletions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER,
            chat_id INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            delete_after TEXT
        )
    `);

    // ========================================================================
    // BILLS - Global proposals
    // ========================================================================
    db.exec(`
        CREATE TABLE IF NOT EXISTS bills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT,
            target TEXT,
            source_guild INTEGER,
            metadata TEXT DEFAULT '{}',
            status TEXT DEFAULT 'pending',
            voted_by TEXT DEFAULT '[]',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            resolved_at TEXT
        )
    `);

    logger.info("Database tables created/verified");
}

/**
 * Get database instance
 */
function getDb() {
    return db;
}

/**
 * Get or create guild config
 */
function getGuildConfig(guildId) {
    let config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
    if (!config) {
        db.prepare('INSERT INTO guild_config (guild_id) VALUES (?)').run(guildId);
        config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
    }
    return config;
}

/**
 * Update guild config
 */
function updateGuildConfig(guildId, updates) {
    const keys = Object.keys(updates);
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), guildId];
    db.prepare(`UPDATE guild_config SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`).run(...values);
}

/**
 * Get or create user in cache
 */
function getUser(userId) {
    return db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
}

/**
 * Update or insert user info (called on every message to keep cache fresh)
 */
function upsertUser(userInfo) {
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
 */
function setUserGlobalBan(userId, isBanned) {
    db.prepare('UPDATE users SET is_banned_global = ? WHERE user_id = ?').run(isBanned ? 1 : 0, userId);
}

module.exports = {
    init,
    getDb,
    getGuildConfig,
    updateGuildConfig,
    getUser,
    upsertUser,
    setUserGlobalBan
};
