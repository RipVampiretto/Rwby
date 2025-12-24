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
    // Action Log
    'log_channel_id',
    'log_events',
    // Edit Monitor
    'edit_monitor_enabled',
    'edit_action',
    'edit_grace_period',
    // Word Filter
    'keyword_enabled',
    'keyword_sync_global',
    // Language Filter
    'lang_enabled',
    'allowed_languages',
    'lang_action',
    // Link Filter
    'link_enabled',
    'link_sync_global',
    // Media Filter
    'media_enabled',
    'media_action',
    'media_check_photos',
    'media_check_videos',
    'media_check_gifs',
    'media_check_stickers',
    'media_frame_interval',
    'media_blocked_categories',
    // Report System
    'report_enabled',
    'report_threshold',
    'report_duration',
    'report_initiator_tier',
    'report_voter_tier',
    'report_mode',
    'report_action_scam',
    'report_action_nsfw',
    'report_action_hate',
    // Spam Patterns
    'spam_patterns_enabled',
    'spam_patterns_action',
    'spam_patterns_sync_global',
    // Global Blacklist
    'blacklist_enabled',
    'blacklist_notify',
    // Welcome & Captcha System
    'welcome_enabled',
    'welcome_msg_enabled',
    'welcome_message',
    'welcome_buttons',
    'captcha_enabled',
    'captcha_mode',
    'captcha_timeout',
    'welcome_autodelete_timer',
    'rules_enabled',
    'rules_link',
    'captcha_logs_enabled',
    // UI Language
    'ui_language'
]);

/**
 * Default config values for new guilds (all disabled)
 */
const DEFAULT_CONFIG = {
    edit_monitor_enabled: false,
    keyword_enabled: false,
    lang_enabled: false,
    link_enabled: false,
    media_enabled: false,
    media_check_photos: false,
    media_check_videos: false,
    media_check_gifs: false,
    media_check_stickers: false,
    media_blocked_categories: ['minors'],
    report_enabled: false,
    spam_patterns_enabled: false,
    blacklist_enabled: false,
    welcome_enabled: false,
    captcha_enabled: false,
    rules_enabled: false,
    welcome_msg_enabled: false
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
        'edit_monitor_enabled',
        'keyword_enabled',
        'keyword_sync_global',
        'lang_enabled',
        'link_enabled',
        'link_sync_global',
        'media_enabled',
        'media_check_photos',
        'media_check_videos',
        'media_check_gifs',
        'media_check_stickers',
        'report_enabled',
        'spam_patterns_enabled',
        'spam_patterns_sync_global',
        'blacklist_enabled',
        'blacklist_notify',
        'welcome_enabled',
        'welcome_msg_enabled',
        'captcha_enabled',
        'rules_enabled',
        'captcha_logs_enabled'
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
    if (!title) return false; // Should have title if group/supergroup

    const result = await queryOne(
        `
        INSERT INTO guild_config (guild_id, guild_name) VALUES ($1, $2)
        ON CONFLICT (guild_id) DO UPDATE SET 
            guild_name = EXCLUDED.guild_name,
            updated_at = NOW()
        RETURNING created_at, updated_at
    `,
        [id, title]
    );

    // If created_at equals updated_at, it means it was just inserted
    // (since update would change updated_at to now, while created_at remains old)
    return result && result.created_at.getTime() === result.updated_at.getTime();
}

// Alias for backwards compatibility (both names now point to same function)
const fetchGuildConfig = getGuildConfig;

module.exports = {
    getGuildConfig,
    fetchGuildConfig,
    updateGuildConfig,
    upsertGuild
};
