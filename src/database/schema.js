const { query } = require('./connection');
const logger = require('../middlewares/logger');

/**
 * Create all required tables (PostgreSQL)
 */
async function createTables() {
    // ========================================================================
    // USERS CACHE - User info cache
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
            log_events JSONB DEFAULT '["ban","delete","ai_action"]',
            log_format TEXT DEFAULT 'standard',
            
            -- Anti-Spam
            spam_enabled BOOLEAN DEFAULT FALSE,
            spam_sensitivity TEXT DEFAULT 'medium',
            spam_action_volume TEXT DEFAULT 'delete',
            spam_action_repetition TEXT DEFAULT 'delete',
            spam_volume_limit_60s INTEGER DEFAULT 10,
            spam_volume_limit_10s INTEGER DEFAULT 5,
            spam_duplicate_limit INTEGER DEFAULT 3,
            
            -- AI Moderation
            ai_enabled BOOLEAN DEFAULT FALSE,
            ai_action_scam TEXT DEFAULT 'ban',
            ai_action_hate TEXT DEFAULT 'report_only',
            ai_action_nsfw TEXT DEFAULT 'delete',
            ai_action_threat TEXT DEFAULT 'report_only',
            ai_action_spam TEXT DEFAULT 'delete',
            ai_confidence_threshold REAL DEFAULT 0.75,
            ai_context_aware BOOLEAN DEFAULT TRUE,
            ai_sensitivity TEXT DEFAULT 'medium',
            ai_context_messages INTEGER DEFAULT 3,
            ai_tier_bypass INTEGER DEFAULT 2,
            
            -- Anti-Edit Abuse
            edit_monitor_enabled BOOLEAN DEFAULT FALSE,
            edit_action TEXT DEFAULT 'delete',
            edit_grace_period INTEGER DEFAULT 0,
            
            -- Intelligent Profiler
            profiler_enabled BOOLEAN DEFAULT FALSE,
            profiler_action_link TEXT DEFAULT 'delete',
            profiler_action_forward TEXT DEFAULT 'delete',
            profiler_action_pattern TEXT DEFAULT 'report_only',
            
            -- Keyword Monitor
            keyword_sync_global BOOLEAN DEFAULT FALSE,
            
            -- Language Monitor
            lang_enabled BOOLEAN DEFAULT FALSE,
            allowed_languages JSONB DEFAULT '["en"]',
            lang_action TEXT DEFAULT 'delete',
            lang_min_chars INTEGER DEFAULT 20,
            lang_confidence_threshold REAL DEFAULT 0.8,
            lang_tier_bypass INTEGER DEFAULT 2,
            
            -- Link Monitor
            link_enabled BOOLEAN DEFAULT FALSE,
            link_action_unknown TEXT DEFAULT 'report_only',
            link_sync_global BOOLEAN DEFAULT FALSE,
            link_tier_bypass INTEGER DEFAULT 2,
            
            -- NSFW Monitor
            nsfw_enabled BOOLEAN DEFAULT FALSE,
            nsfw_action TEXT DEFAULT 'delete',
            nsfw_threshold REAL DEFAULT 0.7,
            nsfw_check_photos BOOLEAN DEFAULT TRUE,
            nsfw_check_videos BOOLEAN DEFAULT TRUE,
            nsfw_check_gifs BOOLEAN DEFAULT TRUE,
            nsfw_check_stickers BOOLEAN DEFAULT FALSE,
            nsfw_frame_interval_percent INTEGER DEFAULT 5,
            nsfw_frame_interval_percent INTEGER DEFAULT 5,
            nsfw_tier_bypass INTEGER DEFAULT 2,
            nsfw_blocked_categories JSONB DEFAULT '["real_nudity","real_sex","hentai","gore","minors"]'::jsonb,
            
            -- Visual Immune System
            visual_enabled BOOLEAN DEFAULT FALSE,
            visual_action TEXT DEFAULT 'delete',
            visual_sync_global BOOLEAN DEFAULT FALSE,
            visual_hamming_threshold INTEGER DEFAULT 5,
            
            -- Vote Ban / Smart Report System
            voteban_enabled BOOLEAN DEFAULT FALSE,
            voteban_threshold INTEGER DEFAULT 5,
            voteban_duration_minutes INTEGER DEFAULT 30,
            voteban_initiator_tier INTEGER DEFAULT 1,
            voteban_voter_tier INTEGER DEFAULT 0,
            
            -- Smart Report System
            report_mode TEXT DEFAULT 'ai_voteban',  -- 'ai_only', 'voteban_only', 'ai_voteban'
            report_ai_fallback TEXT DEFAULT 'voteban',  -- 'voteban', 'report_only' (when AI says safe)
            report_mode TEXT DEFAULT 'ai_voteban',  -- 'ai_only', 'voteban_only', 'ai_voteban'
            report_ai_fallback TEXT DEFAULT 'voteban',  -- 'voteban', 'report_only' (when AI says safe)
            report_context_messages INTEGER DEFAULT 10,
            report_action_scam TEXT DEFAULT 'report_only',
            report_action_nsfw TEXT DEFAULT 'report_only',
            report_action_spam TEXT DEFAULT 'report_only',
            
            -- Modal Pattern System
            modal_enabled BOOLEAN DEFAULT FALSE,
            modal_action TEXT DEFAULT 'report_only',
            modal_sync_global BOOLEAN DEFAULT FALSE,
            modal_tier_bypass INTEGER DEFAULT 2,
            
            -- CAS Ban / Global Blacklist
            casban_enabled BOOLEAN DEFAULT FALSE,
            
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
    // USER ACTIVE STATS - Real-time spam tracking
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS user_active_stats (
            user_id BIGINT,
            guild_id BIGINT,
            msg_count_60s INTEGER DEFAULT 0,
            msg_count_10s INTEGER DEFAULT 0,
            last_msg_content TEXT,
            last_msg_ts TIMESTAMPTZ,
            duplicate_count INTEGER DEFAULT 0,
            violation_count_24h INTEGER DEFAULT 0,
            last_violation_ts TIMESTAMPTZ,
            PRIMARY KEY (user_id, guild_id)
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
    // VISUAL HASHES - Image fingerprints
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS visual_hashes (
            id SERIAL PRIMARY KEY,
            phash TEXT NOT NULL,
            type TEXT DEFAULT 'ban',
            category TEXT,
            guild_id BIGINT DEFAULT 0,
            added_by BIGINT,
            match_count INTEGER DEFAULT 0,
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
    // STAFF NOTES - Notes on users (staff-group scoped)
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
    // INTEL DATA - Federated intelligence
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS intel_data (
            id SERIAL PRIMARY KEY,
            type TEXT NOT NULL,
            value TEXT NOT NULL,
            metadata JSONB DEFAULT '{}',
            added_by_guild BIGINT,
            added_by_user BIGINT,
            trust_weight INTEGER DEFAULT 50,
            confirmations INTEGER DEFAULT 0,
            reports INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // ========================================================================
    // GUILD TRUST - Network trust scores
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS guild_trust (
            guild_id BIGINT PRIMARY KEY,
            guild_name TEXT,
            tier INTEGER DEFAULT 0,
            trust_score INTEGER DEFAULT 50,
            contributions_valid INTEGER DEFAULT 0,
            contributions_invalid INTEGER DEFAULT 0,
            joined_at TIMESTAMPTZ DEFAULT NOW(),
            last_sync TIMESTAMPTZ DEFAULT NOW()
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
    // PENDING DELETIONS - Auto-delete after 24h
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
    // BILLS - Global proposals
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
    // SPAM MODALS - Language/Category based spam patterns
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
    // CAS BANS - Combot Anti-Spam banned users
    // ========================================================================
    await query(`
        CREATE TABLE IF NOT EXISTS cas_bans (
            user_id BIGINT PRIMARY KEY,
            offenses INTEGER DEFAULT 1,
            time_added TIMESTAMPTZ,
            imported_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // Create indexes for performance
    await query(`CREATE INDEX IF NOT EXISTS idx_user_trust_flux_user ON user_trust_flux(user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_user_trust_flux_guild ON user_trust_flux(guild_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_word_filters_guild ON word_filters(guild_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_link_rules_guild ON link_rules(guild_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_visual_hashes_phash ON visual_hashes(phash)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_active_votes_chat ON active_votes(chat_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_message_snapshots_chat ON message_snapshots(chat_id)`);

    logger.info('[database] All tables created/verified');
}

module.exports = {
    createTables
};
