/**
 * @fileoverview Feature Gating System
 * @module features/feature-gating
 *
 * @description
 * Centralized system for super admins to control feature access globally and per-group.
 * Features can be:
 * - Enabled/disabled globally (default for all groups)
 * - Overridden per-group (whitelist/blacklist specific groups)
 * - Groups can be completely blacklisted (all features blocked)
 *
 * Local guild_config is NEVER modified - only gated from above.
 */

const logger = require('../middlewares/logger');

let db = null;

/**
 * List of all gatable features
 * @constant {Object}
 */
const FEATURES = {
    WELCOME_SYSTEM: 'welcome_system',
    STAFF_COORDINATION: 'staff_coordination',
    REPORT_SYSTEM: 'report_system',
    EDIT_MONITOR: 'edit_monitor',
    LANGUAGE_FILTER: 'language_filter',
    MEDIA_FILTER: 'media_filter',
    MENTION_FILTER: 'mention_filter',
    GLOBAL_BLACKLIST: 'global_blacklist',
    LINK_FILTER: 'link_filter',
    WORD_FILTER: 'word_filter',
    SPAM_PATTERNS: 'spam_patterns',
    ACTION_LOG: 'action_log'
};

/**
 * Feature descriptions for UI
 * @constant {Object}
 */
const FEATURE_INFO = {
    welcome_system: { name: 'Welcome & Captcha', emoji: '👋' },
    staff_coordination: { name: 'Staff Coordination', emoji: '👮' },
    report_system: { name: 'Report/VoteBan', emoji: '⚖️' },
    edit_monitor: { name: 'Edit Monitor', emoji: '✏️' },
    language_filter: { name: 'Language Filter', emoji: '🌍' },
    media_filter: { name: 'Media/NSFW Filter', emoji: '🖼️' },
    mention_filter: { name: 'Mention Filter', emoji: '👤' },
    global_blacklist: { name: 'Global Blacklist', emoji: '🚫' },
    link_filter: { name: 'Link Filter', emoji: '🔗' },
    word_filter: { name: 'Word Filter', emoji: '🔤' },
    spam_patterns: { name: 'Spam Patterns', emoji: '🎭' },
    action_log: { name: 'Action Log', emoji: '📋' }
};

/**
 * Initialize module with database
 * @param {object} database - Database instance
 */
function init(database) {
    db = database;
}

/**
 * Check if a group is completely blacklisted
 * @param {number} guildId - Guild ID
 * @returns {Promise<object|null>} Blacklist entry or null
 */
async function isGuildBlacklisted(guildId) {
    try {
        const result = await db.queryOne(
            `SELECT * FROM guild_blacklist 
             WHERE guild_id = $1 
             AND (expires_at IS NULL OR expires_at > NOW())`,
            [guildId]
        );
        return result || null;
    } catch (e) {
        logger.error(`[feature-gating] isGuildBlacklisted error: ${e.message}`);
        return null;
    }
}

/**
 * Check if a group can use a specific feature
 * @param {number} guildId - Guild ID
 * @param {string} featureName - Feature name from FEATURES
 * @returns {Promise<boolean>} True if feature is allowed
 */
async function canUseFeature(guildId, featureName) {
    try {
        // 1. Check if group is completely blacklisted
        const blacklisted = await isGuildBlacklisted(guildId);
        if (blacklisted) {
            return false;
        }

        // 2. Check for per-group override
        const override = await db.queryOne(
            'SELECT is_allowed FROM guild_feature_access WHERE guild_id = $1 AND feature_name = $2',
            [guildId, featureName]
        );
        if (override) {
            return override.is_allowed;
        }

        // 3. Check global default
        const globalFlag = await db.queryOne(
            'SELECT enabled_by_default FROM global_feature_flags WHERE feature_name = $1',
            [featureName]
        );
        if (globalFlag) {
            return globalFlag.enabled_by_default;
        }

        // 4. Default: enabled if not configured
        return true;
    } catch (e) {
        logger.error(`[feature-gating] canUseFeature error: ${e.message}`);
        // Fail open - allow feature if check fails
        return true;
    }
}

/**
 * Set global default for a feature
 * @param {string} featureName - Feature name
 * @param {boolean} enabled - Enabled by default
 * @param {string} description - Optional description
 */
async function setFeatureDefault(featureName, enabled, description = null) {
    try {
        await db.query(
            `INSERT INTO global_feature_flags (feature_name, enabled_by_default, description)
             VALUES ($1, $2, $3)
             ON CONFLICT (feature_name) DO UPDATE SET
                enabled_by_default = $2,
                description = COALESCE($3, global_feature_flags.description)`,
            [featureName, enabled, description]
        );
        logger.info(`[feature-gating] Global default for ${featureName}: ${enabled}`);
    } catch (e) {
        logger.error(`[feature-gating] setFeatureDefault error: ${e.message}`);
        throw e;
    }
}

/**
 * Set feature access for a specific group
 * @param {number} guildId - Guild ID
 * @param {string} featureName - Feature name
 * @param {boolean} allowed - Whether feature is allowed
 * @param {string} reason - Reason for the change
 * @param {number} setBy - Super admin user ID
 */
async function setGuildFeatureAccess(guildId, featureName, allowed, reason, setBy) {
    try {
        await db.query(
            `INSERT INTO guild_feature_access (guild_id, feature_name, is_allowed, reason, set_by, set_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (guild_id, feature_name) DO UPDATE SET
                is_allowed = $3,
                reason = $4,
                set_by = $5,
                set_at = NOW()`,
            [guildId, featureName, allowed, reason, setBy]
        );
        logger.info(`[feature-gating] Guild ${guildId} feature ${featureName}: ${allowed ? 'allowed' : 'blocked'}`);
    } catch (e) {
        logger.error(`[feature-gating] setGuildFeatureAccess error: ${e.message}`);
        throw e;
    }
}

/**
 * Remove feature override for a group (revert to global default)
 * @param {number} guildId - Guild ID
 * @param {string} featureName - Feature name
 */
async function removeGuildFeatureAccess(guildId, featureName) {
    try {
        await db.query('DELETE FROM guild_feature_access WHERE guild_id = $1 AND feature_name = $2', [
            guildId,
            featureName
        ]);
        logger.info(`[feature-gating] Guild ${guildId} feature ${featureName}: override removed`);
    } catch (e) {
        logger.error(`[feature-gating] removeGuildFeatureAccess error: ${e.message}`);
        throw e;
    }
}

/**
 * Add group to blacklist
 * @param {number} guildId - Guild ID
 * @param {string} reason - Reason for blacklist
 * @param {number} blacklistedBy - Super admin user ID
 * @param {number|null} days - Days until expiry (null = permanent)
 */
async function blacklistGuild(guildId, reason, blacklistedBy, days = null) {
    try {
        const expiresAt = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() : null;
        await db.query(
            `INSERT INTO guild_blacklist (guild_id, reason, blacklisted_by, blacklisted_at, expires_at)
             VALUES ($1, $2, $3, NOW(), $4)
             ON CONFLICT (guild_id) DO UPDATE SET
                reason = $2,
                blacklisted_by = $3,
                blacklisted_at = NOW(),
                expires_at = $4`,
            [guildId, reason, blacklistedBy, expiresAt]
        );
        logger.info(`[feature-gating] Guild ${guildId} blacklisted: ${reason}`);
    } catch (e) {
        logger.error(`[feature-gating] blacklistGuild error: ${e.message}`);
        throw e;
    }
}

/**
 * Remove group from blacklist
 * @param {number} guildId - Guild ID
 */
async function unblacklistGuild(guildId) {
    try {
        await db.query('DELETE FROM guild_blacklist WHERE guild_id = $1', [guildId]);
        logger.info(`[feature-gating] Guild ${guildId} removed from blacklist`);
    } catch (e) {
        logger.error(`[feature-gating] unblacklistGuild error: ${e.message}`);
        throw e;
    }
}

/**
 * Get all blacklisted groups
 * @returns {Promise<Array>} List of blacklisted groups
 */
async function getBlacklistedGuilds() {
    try {
        return await db.queryAll(
            `SELECT gb.*, gc.guild_name 
             FROM guild_blacklist gb
             LEFT JOIN guild_config gc ON gb.guild_id = gc.guild_id
             WHERE expires_at IS NULL OR expires_at > NOW()
             ORDER BY blacklisted_at DESC`
        );
    } catch (e) {
        logger.error(`[feature-gating] getBlacklistedGuilds error: ${e.message}`);
        return [];
    }
}

/**
 * Get all feature flags with their current status
 * @returns {Promise<Array>} List of features with status
 */
async function getAllFeatureFlags() {
    try {
        const results = [];
        for (const [key, featureName] of Object.entries(FEATURES)) {
            const flag = await db.queryOne(
                'SELECT enabled_by_default FROM global_feature_flags WHERE feature_name = $1',
                [featureName]
            );
            const info = FEATURE_INFO[featureName] || { name: featureName, emoji: '❓' };
            results.push({
                key,
                name: featureName,
                displayName: info.name,
                emoji: info.emoji,
                enabledByDefault: flag?.enabled_by_default ?? true
            });
        }
        return results;
    } catch (e) {
        logger.error(`[feature-gating] getAllFeatureFlags error: ${e.message}`);
        return [];
    }
}

/**
 * Get feature overrides for a specific guild
 * @param {number} guildId - Guild ID
 * @returns {Promise<Array>} List of overrides
 */
async function getGuildFeatureOverrides(guildId) {
    try {
        return await db.queryAll('SELECT * FROM guild_feature_access WHERE guild_id = $1', [guildId]);
    } catch (e) {
        logger.error(`[feature-gating] getGuildFeatureOverrides error: ${e.message}`);
        return [];
    }
}

module.exports = {
    init,
    FEATURES,
    FEATURE_INFO,
    isGuildBlacklisted,
    canUseFeature,
    setFeatureDefault,
    setGuildFeatureAccess,
    removeGuildFeatureAccess,
    blacklistGuild,
    unblacklistGuild,
    getBlacklistedGuilds,
    getAllFeatureFlags,
    getGuildFeatureOverrides
};
