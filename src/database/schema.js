const { query } = require('./connection');
const logger = require('../middlewares/logger');

/**
 * Create all required tables (PostgreSQL)
 * Database will be rebuilt from scratch - no migration support
 */
async function createTables() {
    // ========================================================================
    // USERS - User info cache
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS users (
            user_id BIGINT PRIMARY KEY,
            username TEXT,
            first_name TEXT,
            last_name TEXT,
            language_code TEXT,
            first_seen TIMESTAMPTZ DEFAULT NOW(),
            last_seen TIMESTAMPTZ DEFAULT NOW(),
            is_banned_global BOOLEAN DEFAULT FALSE
        )
    `);

    // ========================================================================
    // GUILD CONFIG - Per-group settings
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS guild_config (
            guild_id BIGINT PRIMARY KEY,
            guild_name TEXT,
            
            -- Staff Coordination
            staff_group_id BIGINT,
            staff_topics JSONB DEFAULT '{}',
            
            -- Action Log
            log_channel_id BIGINT,
            log_events JSONB DEFAULT '{}',
            
            -- Edit Monitor
            edit_monitor_enabled BOOLEAN DEFAULT FALSE,
            edit_action TEXT DEFAULT 'delete',
            edit_grace_period INTEGER DEFAULT 0,
            
            -- Word Filter
            keyword_enabled BOOLEAN DEFAULT FALSE,
            keyword_sync_global BOOLEAN DEFAULT FALSE,
            
            -- Language Filter
            lang_enabled BOOLEAN DEFAULT FALSE,
            allowed_languages JSONB DEFAULT '["en"]',
            lang_action TEXT DEFAULT 'delete',
            
            -- Link Filter
            link_enabled BOOLEAN DEFAULT FALSE,
            link_sync_global BOOLEAN DEFAULT FALSE,
            
            -- Media Filter (ex NSFW)
            media_enabled BOOLEAN DEFAULT FALSE,
            media_action TEXT DEFAULT 'delete',
            media_check_photos BOOLEAN DEFAULT FALSE,
            media_check_videos BOOLEAN DEFAULT FALSE,
            media_check_gifs BOOLEAN DEFAULT FALSE,
            media_check_stickers BOOLEAN DEFAULT FALSE,
            media_frame_interval INTEGER DEFAULT 5,
            media_tier_bypass INTEGER DEFAULT 2,
            media_blocked_categories JSONB DEFAULT '["minors"]'::jsonb,
            
            -- Report System (ex VoteBan)
            report_enabled BOOLEAN DEFAULT FALSE,
            report_threshold INTEGER DEFAULT 5,
            report_duration INTEGER DEFAULT 30,
            report_initiator_tier INTEGER DEFAULT 1,
            report_voter_tier INTEGER DEFAULT 0,
            report_mode TEXT DEFAULT 'vote',
            report_action_scam TEXT DEFAULT 'report_only',
            report_action_nsfw TEXT DEFAULT 'report_only',
            report_action_hate TEXT DEFAULT 'report_only',
            
            -- Spam Patterns (ex Modal)
            spam_patterns_enabled BOOLEAN DEFAULT FALSE,
            spam_patterns_action TEXT DEFAULT 'report_only',
            spam_patterns_sync_global BOOLEAN DEFAULT FALSE,
            spam_patterns_tier_bypass INTEGER DEFAULT 2,
            
            -- Global Blacklist (ex CAS Ban)
            blacklist_enabled BOOLEAN DEFAULT FALSE,
            blacklist_notify BOOLEAN DEFAULT FALSE,
            
            -- Welcome & Captcha System
            welcome_enabled BOOLEAN DEFAULT FALSE,
            welcome_msg_enabled BOOLEAN DEFAULT FALSE,
            welcome_message TEXT,
            welcome_buttons JSONB,
            captcha_enabled BOOLEAN DEFAULT FALSE,
            captcha_mode TEXT DEFAULT 'button',
            captcha_timeout INTEGER DEFAULT 5,
            welcome_autodelete_timer INTEGER,
            rules_enabled BOOLEAN DEFAULT FALSE,
            rules_link TEXT,
            captcha_logs_enabled BOOLEAN DEFAULT FALSE,
            
            -- UI Language
            ui_language TEXT DEFAULT 'en',
            
            -- Metadata
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // ========================================================================
    // USER TRUST FLUX - Per-user per-group reputation
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS user_trust_flux (
            user_id BIGINT,
            guild_id BIGINT,
            local_flux INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            last_activity TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (user_id, guild_id)
        )
    `);

    // ========================================================================
    // USER GLOBAL FLUX - Global reputation
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS user_global_flux (
            user_id BIGINT PRIMARY KEY,
            global_flux INTEGER DEFAULT 0,
            groups_participated INTEGER DEFAULT 0,
            last_sync TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // ========================================================================
    // MESSAGE SNAPSHOTS - For edit abuse detection
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS message_snapshots (
            message_id BIGINT,
            chat_id BIGINT,
            user_id BIGINT,
            original_text TEXT,
            original_has_link BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            edit_count INTEGER DEFAULT 0,
            PRIMARY KEY (message_id, chat_id)
        )
    `);

    // ========================================================================
    // WORD FILTERS - Keyword blacklist (global only)
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS word_filters (
            id SERIAL PRIMARY KEY,
            word TEXT NOT NULL,
            is_regex BOOLEAN DEFAULT FALSE,
            action TEXT DEFAULT 'delete',
            category TEXT DEFAULT 'custom',
            severity INTEGER DEFAULT 1,
            match_whole_word BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // ========================================================================
    // LINK RULES - Whitelist/Blacklist (global only)
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS link_rules (
            id SERIAL PRIMARY KEY,
            pattern TEXT NOT NULL,
            type TEXT NOT NULL,
            action TEXT DEFAULT 'delete',
            category TEXT,
            added_by BIGINT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // ========================================================================
    // ACTIVE VOTES - Community vote ban
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS active_votes (
            vote_id SERIAL PRIMARY KEY,
            target_user_id BIGINT,
            target_username TEXT,
            chat_id BIGINT,
            poll_message_id BIGINT,
            initiated_by BIGINT,
            reason TEXT,
            votes_yes INTEGER DEFAULT 0,
            votes_no INTEGER DEFAULT 0,
            required_votes INTEGER,
            voters JSONB DEFAULT '[]',
            status TEXT DEFAULT 'active',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            expires_at TIMESTAMPTZ
        )
    `);

    // ========================================================================
    // STAFF NOTES - Notes on users
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS staff_notes (
            id SERIAL PRIMARY KEY,
            user_id BIGINT,
            staff_group_id BIGINT,
            note_text TEXT,
            severity TEXT DEFAULT 'info',
            created_by BIGINT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // ========================================================================
    // GLOBAL CONFIG - SuperAdmin settings
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS global_config (
            id INTEGER PRIMARY KEY DEFAULT 1,
            parliament_group_id BIGINT,
            global_topics JSONB DEFAULT '{}',
            global_log_channel BIGINT
        )
    `);

    // ========================================================================
    // PENDING DELETIONS - Auto-delete messages
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS pending_deletions (
            id SERIAL PRIMARY KEY,
            message_id BIGINT,
            chat_id BIGINT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            delete_after TIMESTAMPTZ
        )
    `);

    // ========================================================================
    // SPAM PATTERNS - Pattern-based spam detection
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS spam_patterns (
            id SERIAL PRIMARY KEY,
            language TEXT NOT NULL,
            category TEXT NOT NULL,
            patterns JSONB DEFAULT '[]',
            action TEXT DEFAULT 'report_only',
            similarity_threshold REAL DEFAULT 0.6,
            enabled BOOLEAN DEFAULT FALSE,
            created_by BIGINT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(language, category)
        )
    `);

    // ========================================================================
    // GUILD PATTERN OVERRIDES - Per-group pattern enable/disable
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS guild_pattern_overrides (
            guild_id BIGINT NOT NULL,
            modal_id INTEGER NOT NULL,
            enabled BOOLEAN DEFAULT TRUE,
            PRIMARY KEY (guild_id, modal_id)
        )
    `);

    // ========================================================================
    // CAS BANS - Combot Anti-Spam cached bans
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS cas_bans (
            user_id BIGINT PRIMARY KEY,
            offenses INTEGER DEFAULT 1,
            time_added TIMESTAMPTZ,
            imported_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // ========================================================================
    // INDEXES
    // ========================================================================
    await query(`CREATE INDEX IF NOT EXISTS idx_user_trust_flux_user ON user_trust_flux(user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_user_trust_flux_guild ON user_trust_flux(guild_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_word_filters_word ON word_filters(word)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_link_rules_pattern ON link_rules(pattern)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_active_votes_chat ON active_votes(chat_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_message_snapshots_chat ON message_snapshots(chat_id)`);

    logger.info('[database] All tables created/verified');
}

module.exports = {
    createTables
};
