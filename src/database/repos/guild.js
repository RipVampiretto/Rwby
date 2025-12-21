const { queryOne, query } = require('../connection');
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
    // Welcome & Captcha System
    'welcome_enabled', 'welcome_msg_enabled', 'welcome_message', 'welcome_buttons', 'captcha_enabled', 'captcha_mode', 'kick_timeout',
    'welcome_autodelete_timer', 'rules_enabled', 'rules_link', 'captcha_logs_enabled',
    // UI Language
    'ui_language'
]);

/**
 * Get or create guild config
 * @param {number} guildId - Guild ID
 * @returns {Promise<object>}
 */
async function getGuildConfig(guildId) {
    let config = await queryOne('SELECT * FROM guild_config WHERE guild_id = $1', [guildId]);
    if (!config) {
        await query('INSERT INTO guild_config (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [guildId]);
        config = await queryOne('SELECT * FROM guild_config WHERE guild_id = $1', [guildId]);
    }
    return config;
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
}

module.exports = {
    getGuildConfig,
    updateGuildConfig,
    upsertGuild
};
