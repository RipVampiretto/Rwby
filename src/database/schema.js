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
            is_bot BOOLEAN DEFAULT FALSE,
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
            
            -- Admin Logger
            log_channel_id BIGINT,
            log_events JSONB DEFAULT '{"ban":true,"delete":true}',
            
            -- Anti-Edit Abuse
            edit_monitor_enabled BOOLEAN DEFAULT FALSE,
            edit_action TEXT DEFAULT 'delete',
            edit_grace_period INTEGER DEFAULT 0,
            
            -- Keyword Monitor
            keyword_enabled BOOLEAN DEFAULT FALSE,
            keyword_sync_global BOOLEAN DEFAULT FALSE,
            
            -- Language Monitor
            lang_enabled BOOLEAN DEFAULT FALSE,
            allowed_languages JSONB DEFAULT '["en"]',
            lang_action TEXT DEFAULT 'delete',
            
            -- Link Monitor
            link_enabled BOOLEAN DEFAULT FALSE,
            link_action_unknown TEXT DEFAULT 'report_only',
            link_sync_global BOOLEAN DEFAULT FALSE,
            link_tier_bypass INTEGER DEFAULT 2,
            
            -- NSFW Monitor (Media Analysis)
            nsfw_enabled BOOLEAN DEFAULT FALSE,
            nsfw_action TEXT DEFAULT 'delete',
            nsfw_threshold REAL DEFAULT 0.7,
            nsfw_check_photos BOOLEAN DEFAULT TRUE,
            nsfw_check_videos BOOLEAN DEFAULT TRUE,
            nsfw_check_gifs BOOLEAN DEFAULT TRUE,
            nsfw_check_stickers BOOLEAN DEFAULT FALSE,
            nsfw_frame_interval_percent INTEGER DEFAULT 5,
            nsfw_tier_bypass INTEGER DEFAULT 2,
            nsfw_blocked_categories JSONB DEFAULT '["real_nudity","real_sex","hentai","real_gore","drawn_gore","minors","scam_visual"]'::jsonb,
            
            -- Vote Ban / Report System
            voteban_enabled BOOLEAN DEFAULT FALSE,
            voteban_threshold INTEGER DEFAULT 5,
            voteban_duration_minutes INTEGER DEFAULT 30,
            voteban_initiator_tier INTEGER DEFAULT 1,
            voteban_voter_tier INTEGER DEFAULT 0,
            
            -- Modal Pattern System
            modal_enabled BOOLEAN DEFAULT FALSE,
            modal_action TEXT DEFAULT 'report_only',
            modal_sync_global BOOLEAN DEFAULT FALSE,
            modal_tier_bypass INTEGER DEFAULT 2,
            
            -- CAS Ban / Global Blacklist
            casban_enabled BOOLEAN DEFAULT FALSE,
            casban_notify BOOLEAN DEFAULT FALSE,
            
            -- Welcome & Captcha System
            welcome_enabled BOOLEAN DEFAULT FALSE,
            welcome_msg_enabled BOOLEAN DEFAULT FALSE,
            welcome_message TEXT,
            welcome_buttons JSONB,
            captcha_enabled BOOLEAN DEFAULT FALSE,
            captcha_mode TEXT DEFAULT 'button',
            kick_timeout INTEGER DEFAULT 5,
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
            total_violations INTEGER DEFAULT 0,
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
    // WORD FILTERS - Keyword blacklist
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS word_filters (
            id SERIAL PRIMARY KEY,
            guild_id BIGINT DEFAULT 0,
            word TEXT NOT NULL,
            is_regex BOOLEAN DEFAULT FALSE,
            action TEXT DEFAULT 'delete',
            category TEXT DEFAULT 'custom',
            severity INTEGER DEFAULT 1,
            match_whole_word BOOLEAN DEFAULT FALSE,
            bypass_tier INTEGER DEFAULT 2,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // ========================================================================
    // LINK RULES - Whitelist/Blacklist
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS link_rules (
            id SERIAL PRIMARY KEY,
            guild_id BIGINT DEFAULT 0,
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
            global_log_channel BIGINT,
            network_mode TEXT DEFAULT 'normal'
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
    // BILLS - Global proposals (SuperAdmin)
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS bills (
            id SERIAL PRIMARY KEY,
            type TEXT,
            target TEXT,
            source_guild BIGINT,
            metadata JSONB DEFAULT '{}',
            status TEXT DEFAULT 'pending',
            voted_by JSONB DEFAULT '[]',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            resolved_at TIMESTAMPTZ
        )
    `);

    // ========================================================================
    // SPAM MODALS - Pattern-based spam detection
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS spam_modals (
            id SERIAL PRIMARY KEY,
            language TEXT NOT NULL,
            category TEXT NOT NULL,
            patterns JSONB DEFAULT '[]',
            action TEXT DEFAULT 'report_only',
            similarity_threshold REAL DEFAULT 0.6,
            enabled BOOLEAN DEFAULT TRUE,
            created_by BIGINT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(language, category)
        )
    `);

    // ========================================================================
    // GUILD MODAL OVERRIDES - Per-group modal enable/disable
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS guild_modal_overrides (
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
    await query(`CREATE INDEX IF NOT EXISTS idx_word_filters_guild ON word_filters(guild_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_link_rules_guild ON link_rules(guild_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_active_votes_chat ON active_votes(chat_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_message_snapshots_chat ON message_snapshots(chat_id)`);

    logger.info('[database] All tables created/verified');
}

module.exports = {
    createTables
};
