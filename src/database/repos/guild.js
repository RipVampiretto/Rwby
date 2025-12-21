const { queryOne, query, queryAll } = require('../connection');
const logger = require('../../middlewares/logger');

// ============================================================================
// IN-MEMORY CACHE FOR GUILD CONFIGS (Enables sync getGuildConfig calls)
// ============================================================================
const _guildCache = new Map();
let _cacheInitialized = false;

/**
 * Default config values for new guilds (used when not in cache yet)
 */
const DEFAULT_CONFIG = {
    spam_enabled: 0, ai_enabled: 0, edit_monitor_enabled: 0, profiler_enabled: 0,
    lang_enabled: 0, link_enabled: 0, nsfw_enabled: 0, visual_enabled: 0,
    voteban_enabled: 0, modal_enabled: 0, casban_enabled: 0, welcome_enabled: 0,
    captcha_enabled: 0, rules_enabled: 0, welcome_msg_enabled: 0
};

/**
 * Initialize cache by loading all guild configs from database
 * Called once at startup
 */
async function initCache() {
    if (_cacheInitialized) return;
    try {
        const configs = await queryAll('SELECT * FROM guild_config');
        for (const config of configs) {
            _guildCache.set(String(config.guild_id), config);
        }
        _cacheInitialized = true;
        logger.info(`[database] Loaded ${_guildCache.size} guild configs into cache`);
    } catch (e) {
        logger.error(`[database] Failed to init guild cache: ${e.message}`);
    }
}

/**
 * Valid column names for guild_config table (whitelist to prevent SQL injection)
 */
const GUILD_CONFIG_COLUMNS = new Set([
    // Staff Coordination
    'guild_name', 'staff_group_id', 'staff_topics',
    // Admin Logger
    'log_channel_id', 'log_events', 'log_format',
    // Anti-Spam
    'spam_enabled', 'spam_sensitivity', 'spam_action_volume', 'spam_action_repetition',
    'spam_volume_limit_60s', 'spam_volume_limit_10s', 'spam_duplicate_limit',
    // AI Moderation
    'ai_enabled', 'ai_action_scam', 'ai_action_nsfw',
    'ai_action_spam', 'ai_confidence_threshold', 'ai_context_aware', 'ai_context_messages', 'ai_tier_bypass',
    // Anti-Edit Abuse
    'edit_monitor_enabled', 'edit_abuse_action', 'edit_lock_tier0',
    'edit_similarity_threshold', 'edit_link_injection_action', 'edit_tier_bypass',
    // Intelligent Profiler
    'profiler_enabled', 'profiler_action_link', 'profiler_action_forward', 'profiler_action_pattern',
    // Keyword Monitor
    'keyword_sync_global',
    // Language Monitor
    'lang_enabled', 'allowed_languages', 'lang_action', 'lang_min_chars',
    'lang_confidence_threshold', 'lang_tier_bypass',
    // Link Monitor
    'link_enabled', 'link_action_unknown', 'link_sync_global', 'link_tier_bypass',
    // NSFW Monitor
    'nsfw_enabled', 'nsfw_action', 'nsfw_threshold', 'nsfw_check_photos',
    'nsfw_check_videos', 'nsfw_check_gifs', 'nsfw_check_stickers',
    'nsfw_frame_interval_percent', 'nsfw_tier_bypass',
    // Visual Immune System
    'visual_enabled', 'visual_action', 'visual_sync_global', 'visual_hamming_threshold',
    // Vote Ban
    'voteban_enabled', 'voteban_threshold', 'voteban_duration_minutes',
    'voteban_initiator_tier', 'voteban_voter_tier',
    // Modal Pattern System
    'modal_enabled', 'modal_action', 'modal_sync_global', 'modal_tier_bypass',
    // CAS Ban / Global Blacklist
    'casban_enabled',
    // Welcome & Captcha System
    'welcome_enabled', 'welcome_msg_enabled', 'welcome_message', 'welcome_buttons', 'captcha_enabled', 'captcha_mode', 'kick_timeout',
    'welcome_autodelete_timer', 'rules_enabled', 'rules_link', 'captcha_logs_enabled',
    // UI Language
    'ui_language'
]);

/**
 * Get guild config - SYNC from cache, async DB fetch if not cached
 * @param {number|string} guildId - Guild ID
 * @returns {object} Config object (sync) or Promise<object> if fetching from DB
 */
function getGuildConfig(guildId) {
    const key = String(guildId);

    // Return from cache if available (sync)
    if (_guildCache.has(key)) {
        return _guildCache.get(key);
    }

    // Not in cache - return default and trigger async load
    const defaultConfig = { guild_id: guildId, ...DEFAULT_CONFIG };
    _guildCache.set(key, defaultConfig); // Set temporary default

    // Async: fetch from DB and update cache
    (async () => {
        try {
            let config = await queryOne('SELECT * FROM guild_config WHERE guild_id = $1', [guildId]);
            if (!config) {
                await query('INSERT INTO guild_config (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [guildId]);
                config = await queryOne('SELECT * FROM guild_config WHERE guild_id = $1', [guildId]);
            }
            if (config) {
                _guildCache.set(key, config);
            }
        } catch (e) {
            logger.error(`[database] Failed to fetch guild config for ${guildId}: ${e.message}`);
        }
    })();

    return defaultConfig;
}

/**
 * Update guild config (with SQL injection protection)
 * @param {number} guildId - Guild ID
 * @param {object} updates - Object with column:value pairs to update
 */
async function updateGuildConfig(guildId, updates) {
    // Filter only valid column names (SQL injection protection)
    const validKeys = Object.keys(updates).filter(k => GUILD_CONFIG_COLUMNS.has(k));

    if (validKeys.length === 0) {
        logger.warn(`[database] updateGuildConfig called with no valid columns: ${Object.keys(updates).join(', ')}`);
        return;
    }

    // Log if some keys were filtered out
    const invalidKeys = Object.keys(updates).filter(k => !GUILD_CONFIG_COLUMNS.has(k));
    if (invalidKeys.length > 0) {
        logger.warn(`[database] updateGuildConfig ignored invalid columns: ${invalidKeys.join(', ')}`);
    }

    // Build parameterized query
    const setClauses = validKeys.map((k, i) => `${k} = $${i + 1}`);
    const values = validKeys.map(k => {
        const val = updates[k];
        // Convert arrays/objects to JSON for JSONB columns
        if (typeof val === 'object' && val !== null) {
            return JSON.stringify(val);
        }
        return val;
    });
    values.push(guildId);

    const sql = `UPDATE guild_config SET ${setClauses.join(', ')}, updated_at = NOW() WHERE guild_id = $${values.length}`;
    await query(sql, values);

    // Sync cache: update cached config with new values
    const key = String(guildId);
    if (_guildCache.has(key)) {
        const cached = _guildCache.get(key);
        for (const k of validKeys) {
            cached[k] = updates[k];
        }
    }
}

/**
 * Ensure guild exists and update name
 * @param {object} chat - Telegram chat object
 */
async function upsertGuild(chat) {
    const { id, title } = chat;
    if (!title) return; // Should have title if group/supergroup

    await query(`
        INSERT INTO guild_config (guild_id, guild_name) VALUES ($1, $2)
        ON CONFLICT (guild_id) DO UPDATE SET 
            guild_name = EXCLUDED.guild_name,
            updated_at = NOW()
    `, [id, title]);

    // Sync cache
    const key = String(id);
    if (_guildCache.has(key)) {
        _guildCache.get(key).guild_name = title;
    }
}

module.exports = {
    initCache,
    getGuildConfig,
    updateGuildConfig,
    upsertGuild
};
