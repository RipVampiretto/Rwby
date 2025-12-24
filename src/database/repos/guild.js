const { queryOne, query, queryAll } = require('../connection');
const logger = require('../../middlewares/logger');

/**
 * Valid column names for guild_config table (whitelist to prevent SQL injection)
 */
const GUILD_CONFIG_COLUMNS = new Set([
    // Staff Coordination
    'guild_name',
    'staff_group_id',
    'staff_topics',
    // Admin Logger
    'log_channel_id',
    'log_events',
    // Anti-Edit Abuse
    'edit_monitor_enabled',
    'edit_action',
    'edit_grace_period',
    // Keyword Monitor
    'keyword_enabled',
    'keyword_sync_global',
    // Language Monitor
    'lang_enabled',
    'allowed_languages',
    'lang_action',
    // Link Monitor
    'link_enabled',
    'link_action_unknown',
    'link_sync_global',
    'link_tier_bypass',
    // NSFW Monitor
    'nsfw_enabled',
    'nsfw_action',
    'nsfw_threshold',
    'nsfw_check_photos',
    'nsfw_check_videos',
    'nsfw_check_gifs',
    'nsfw_check_stickers',
    'nsfw_frame_interval_percent',
    'nsfw_tier_bypass',
    'nsfw_blocked_categories',
    // Visual Immune System
    'visual_enabled',
    'visual_action',
    'visual_sync_global',
    'visual_hamming_threshold',
    // Vote Ban / Smart Report System
    'voteban_enabled',
    'voteban_threshold',
    'voteban_duration_minutes',
    'voteban_initiator_tier',
    'voteban_voter_tier',
    'report_mode',
    'report_ai_fallback',
    'report_context_messages',
    'report_action_scam',
    'report_action_nsfw',
    'report_action_hate',
    // Modal Pattern System
    'modal_enabled',
    'modal_action',
    'modal_sync_global',
    'modal_tier_bypass',
    // CAS Ban / Global Blacklist
    'casban_enabled',
    'casban_notify',
    // Welcome & Captcha System
    'welcome_enabled',
    'welcome_msg_enabled',
    'welcome_message',
    'welcome_buttons',
    'captcha_enabled',
    'captcha_mode',
    'kick_timeout',
    'welcome_autodelete_timer',
    'rules_enabled',
    'rules_link',
    'captcha_logs_enabled',
    // UI Language
    'ui_language'
]);

/**
 * Default config values for new guilds
 */
const DEFAULT_CONFIG = {
    spam_enabled: 0,
    ai_enabled: 0,
    edit_monitor_enabled: 0,
    profiler_enabled: 0,
    lang_enabled: 0,
    link_enabled: 0,
    nsfw_enabled: 0,
    visual_enabled: 0,
    voteban_enabled: 0,
    modal_enabled: 0,
    casban_enabled: 0,
    welcome_enabled: 0,
    captcha_enabled: 0,
    rules_enabled: 0,
    welcome_msg_enabled: 0
};

/**
 * Get guild config - ALWAYS reads from database (no cache)
 * @param {number|string} guildId - Guild ID
 * @returns {Promise<object>} Config object
 */
async function getGuildConfig(guildId) {
    try {
        let config = await queryOne('SELECT * FROM guild_config WHERE guild_id = $1', [guildId]);
        if (!config) {
            // Create new config if doesn't exist
            await query('INSERT INTO guild_config (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [guildId]);
            config = await queryOne('SELECT * FROM guild_config WHERE guild_id = $1', [guildId]);
        }
        return config || { guild_id: guildId, ...DEFAULT_CONFIG };
    } catch (e) {
        logger.error(`[database] Failed to get guild config for ${guildId}: ${e.message}`);
        return { guild_id: guildId, ...DEFAULT_CONFIG };
    }
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

    // Ensure guild exists first
    await query('INSERT INTO guild_config (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [guildId]);

    // Boolean column names (need 0/1 -> true/false conversion)
    const BOOLEAN_COLUMNS = new Set([
        'spam_enabled',
        'ai_enabled',
        'edit_monitor_enabled',
        'profiler_enabled',
        'keyword_enabled',
        'lang_enabled',
        'link_enabled',
        'nsfw_enabled',
        'visual_enabled',
        'voteban_enabled',
        'modal_enabled',
        'casban_enabled',
        'casban_notify',
        'welcome_enabled',
        'captcha_enabled',
        'rules_enabled',
        'welcome_msg_enabled',
        'captcha_logs_enabled',
        'ai_context_aware',
        'edit_lock_tier0',
        'keyword_sync_global',
        'link_sync_global',
        'visual_sync_global',
        'modal_sync_global',
        'nsfw_check_photos',
        'nsfw_check_videos',
        'nsfw_check_gifs',
        'nsfw_check_stickers'
    ]);

    // Build parameterized query
    const setClauses = validKeys.map((k, i) => `${k} = $${i + 1}`);
    const values = validKeys.map(k => {
        let val = updates[k];
        // Convert 0/1 to boolean for BOOLEAN columns
        if (BOOLEAN_COLUMNS.has(k)) {
            val = val === 1 || val === true || val === '1' || val === 'true';
        }
        // Convert arrays/objects to JSON for JSONB columns
        if (typeof val === 'object' && val !== null) {
            return JSON.stringify(val);
        }
        return val;
    });
    values.push(guildId);

    const sql = `UPDATE guild_config SET ${setClauses.join(', ')}, updated_at = NOW() WHERE guild_id = $${values.length}`;

    logger.debug(`[database] updateGuildConfig SQL: ${sql}`);
    logger.debug(`[database] updateGuildConfig values: ${JSON.stringify(values)}`);

    await query(sql, values);

    logger.info(`[database] updateGuildConfig completed for guild ${guildId}`);
}

/**
 * Ensure guild exists and update name
 * @param {object} chat - Telegram chat object
 */
async function upsertGuild(chat) {
    const { id, title } = chat;
    if (!title) return; // Should have title if group/supergroup

    await query(
        `
        INSERT INTO guild_config (guild_id, guild_name) VALUES ($1, $2)
        ON CONFLICT (guild_id) DO UPDATE SET 
            guild_name = EXCLUDED.guild_name,
            updated_at = NOW()
    `,
        [id, title]
    );
}

// Alias for backwards compatibility (both names now point to same function)
const fetchGuildConfig = getGuildConfig;

module.exports = {
    getGuildConfig,
    fetchGuildConfig,
    updateGuildConfig,
    upsertGuild
};
