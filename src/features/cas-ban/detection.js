// ============================================================================
// CAS BAN DETECTION - Fast lookup for banned users
// ============================================================================

const logger = require('../../middlewares/logger');

let db = null;
let _casBanCache = null;
let _cacheLoaded = false;

function init(database) {
    db = database;
}

/**
 * Load all CAS banned user IDs into memory for ultra-fast lookups
 */
async function loadCache() {
    if (!db) {
        logger.warn('[cas-ban] Database not ready, skipping cache load');
        return false;
    }

    try {
        const bans = await db.queryAll('SELECT user_id FROM cas_bans');
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
 * @returns {Promise<boolean>}
 */
async function isCasBanned(userId) {
    // Lazy load cache on first check
    if (!_cacheLoaded) {
        await loadCache();
    }
    return _casBanCache ? _casBanCache.has(userId) : false;
}

/**
 * Add user IDs to the cache (called after sync)
 * @param {number[]} userIds - Array of user IDs to add
 */
function addToCache(userIds) {
    if (!_casBanCache) _casBanCache = new Set();
    for (const id of userIds) {
        _casBanCache.add(id);
    }
}

/**
 * Get cache size
 * @returns {number}
 */
function getCacheSize() {
    return _casBanCache ? _casBanCache.size : 0;
}

/**
 * Reload cache from database
 */
async function reloadCache() {
    await loadCache();
}

module.exports = {
    init,
    isCasBanned,
    addToCache,
    getCacheSize,
    reloadCache
};
