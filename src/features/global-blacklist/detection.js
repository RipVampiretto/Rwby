// ============================================================================
// CAS BAN DETECTION - Fast lookup for banned users
// ============================================================================

const logger = require('../../middlewares/logger');

let db = null;
let _casBanCache = null;
let _cacheLoaded = false;

function init(database) {
    db = database;
    logger.info(`[Gban] Detection module initialized`);
}

/**
 * Load all CAS banned user IDs into memory for ultra-fast lookups
 */
async function loadCache() {
    if (!db) {
        logger.warn('[global-blacklist] Database not ready, skipping cache load');
        return false;
    }

    try {
        const bans = await db.queryAll('SELECT user_id FROM cas_bans');
        // PostgreSQL BIGINT is returned as string, parse to Number for consistent lookup
        _casBanCache = new Set(bans.map(b => Number(b.user_id)));
        _cacheLoaded = true;
        logger.info(`[global-blacklist] Loaded ${_casBanCache.size} CAS bans into cache`);
        return true;
    } catch (e) {
        logger.error(`[global-blacklist] Failed to load cache: ${e.message}`);
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
        logger.debug(`[Gban] Cache not loaded, loading now...`);
        await loadCache();
    }
    // Ensure consistent Number type for lookup
    const isBanned = _casBanCache ? _casBanCache.has(Number(userId)) : false;
    if (isBanned) {
        logger.info(`[Gban] User ${userId} is CAS banned (cache hit)`);
    } else {
        logger.debug(`[Gban] User ${userId} is NOT CAS banned`);
    }
    return isBanned;
}

/**
 * Add user IDs to the cache (called after sync)
 * @param {number[]} userIds - Array of user IDs to add
 */
function addToCache(userIds) {
    if (!_casBanCache) _casBanCache = new Set();
    const countBefore = _casBanCache.size;
    for (const id of userIds) {
        _casBanCache.add(id);
    }
    const added = _casBanCache.size - countBefore;
    logger.debug(`[Gban] Added ${added} new user IDs to cache (total: ${_casBanCache.size})`);
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
    logger.info(`[Gban] Reloading CAS ban cache...`);
    await loadCache();
}

module.exports = {
    init,
    isCasBanned,
    addToCache,
    getCacheSize,
    reloadCache
};
