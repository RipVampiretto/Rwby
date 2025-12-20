const { getDb } = require('../connection');
const logger = require('../../middlewares/logger');

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
    // UI Language
    'ui_language'
]);

/**
 * Get or create guild config
 * @param {number} guildId - Guild ID
 */
function getGuildConfig(guildId) {
    const db = getDb();
    let config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
    if (!config) {
        db.prepare('INSERT INTO guild_config (guild_id) VALUES (?)').run(guildId);
        config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
    }
    return config;
}

/**
 * Update guild config (with SQL injection protection)
 * @param {number} guildId - Guild ID
 * @param {object} updates - Object with column:value pairs to update
 */
function updateGuildConfig(guildId, updates) {
    const db = getDb();

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

    const setClause = validKeys.map(k => `${k} = ?`).join(', ');
    const values = validKeys.map(k => updates[k]);
    values.push(guildId);

    db.prepare(`UPDATE guild_config SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`).run(...values);
}

module.exports = {
    getGuildConfig,
    updateGuildConfig
};
