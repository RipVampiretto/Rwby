// ============================================================================
// CAS BAN DETECTION - Fast lookup for banned users
// ============================================================================

const logger = require('../../middlewares/logger');

let db = null;
let _casBanCache = null; // null means not loaded yet
let _cacheLoaded = false;

function init(database) {
    db = database;
    // Don't load cache immediately - wait for first query or reload
    // This avoids timing issues with DB init
}

/**
 * Load all CAS banned user IDs into memory for ultra-fast lookups
 */
function loadCache() {
    if (!db || !db.getDb()) {
        logger.warn('[cas-ban] Database not ready, skipping cache load');
        return false;
    }

    try {
        const bans = db.getDb().prepare('SELECT user_id FROM cas_bans').all();
        _casBanCache = new Set(bans.map(b => b.user_id));
        _cacheLoaded = true;
        logger.info(`[cas-ban] Loaded ${_casBanCache.size} CAS bans into cache`);
        return true;
    } catch (e) {
        logger.error(`[cas-ban] Failed to load cache: ${e.message}`);
        _casBanCache = new Set();
        return false;
    }
}

/**
 * Check if a user is CAS banned (O(1) lookup from cache)
 * @param {number} userId - Telegram user ID
 * @returns {boolean}
 */
function isCasBanned(userId) {
    // Lazy load cache on first check
    if (!_cacheLoaded) {
        loadCache();
    }
    return _casBanCache ? _casBanCache.has(userId) : false;
}

/**
 * Add user IDs to the cache (called after sync)
 * @param {number[]} userIds - Array of user IDs to add
 */
function addToCache(userIds) {
    for (const id of userIds) {
        _casBanCache.add(id);
    }
}

/**
 * Get cache size
 * @returns {number}
 */
function getCacheSize() {
    return _casBanCache.size;
}

/**
 * Reload cache from database
 */
function reloadCache() {
    loadCache();
}

module.exports = {
    init,
    isCasBanned,
    addToCache,
    getCacheSize,
    reloadCache
};
