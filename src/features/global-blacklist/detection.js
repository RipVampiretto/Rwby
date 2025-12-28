// ============================================================================
// GBAN DETECTION - Fast lookup for banned users (CAS + Local)
// ============================================================================

const logger = require('../../middlewares/logger');

let db = null;
let _casBanCache = null;
let _localBanCache = null;
let _cacheLoaded = false;

function init(database) {
    db = database;
    logger.info(`[Gban] Detection module initialized`);
}

/**
 * Load all banned user IDs into memory for ultra-fast lookups
 * Includes both CAS bans and local gbans (is_banned_global)
 */
async function loadCache() {
    if (!db) {
        logger.warn('[global-blacklist] Database not ready, skipping cache load');
        return false;
    }

    try {
        // Load CAS bans
        const casBans = await db.queryAll('SELECT user_id FROM cas_bans');
        _casBanCache = new Set(casBans.map(b => Number(b.user_id)));

        // Load local gbans (is_banned_global = TRUE)
        const localBans = await db.queryAll('SELECT user_id FROM users WHERE is_banned_global = TRUE');
        _localBanCache = new Set(localBans.map(b => Number(b.user_id)));

        _cacheLoaded = true;
        logger.info(`[global-blacklist] Loaded ${_casBanCache.size} CAS bans + ${_localBanCache.size} local gbans into cache`);
        return true;
    } catch (e) {
        logger.error(`[global-blacklist] Failed to load cache: ${e.message}`);
        _casBanCache = new Set();
        _localBanCache = new Set();
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
    return _casBanCache ? _casBanCache.has(Number(userId)) : false;
}

/**
 * Check if a user is locally gbanned (is_banned_global = TRUE)
 * @param {number} userId - Telegram user ID
 * @returns {Promise<boolean>}
 */
async function isLocallyBanned(userId) {
    // Lazy load cache on first check
    if (!_cacheLoaded) {
        logger.debug(`[Gban] Cache not loaded, loading now...`);
        await loadCache();
    }
    return _localBanCache ? _localBanCache.has(Number(userId)) : false;
}

/**
 * Check if a user is globally banned (CAS OR local gban)
 * This is the main function to use for gban detection
 * @param {number} userId - Telegram user ID
 * @returns {Promise<{banned: boolean, source: 'cas'|'local'|null}>}
 */
async function isGloballyBanned(userId) {
    // Lazy load cache on first check
    if (!_cacheLoaded) {
        logger.debug(`[Gban] Cache not loaded, loading now...`);
        await loadCache();
    }

    const numUserId = Number(userId);

    // Check local gban first (faster to act on our own bans)
    if (_localBanCache && _localBanCache.has(numUserId)) {
        logger.info(`[Gban] User ${userId} is LOCALLY gbanned`);
        return { banned: true, source: 'local' };
    }

    // Check CAS ban
    if (_casBanCache && _casBanCache.has(numUserId)) {
        logger.info(`[Gban] User ${userId} is CAS banned`);
        return { banned: true, source: 'cas' };
    }

    logger.debug(`[Gban] User ${userId} is NOT globally banned`);
    return { banned: false, source: null };
}

/**
 * Add user IDs to the CAS cache (called after sync)
 * @param {number[]} userIds - Array of user IDs to add
 */
function addToCache(userIds) {
    if (!_casBanCache) _casBanCache = new Set();
    const countBefore = _casBanCache.size;
    for (const id of userIds) {
        _casBanCache.add(id);
    }
    const added = _casBanCache.size - countBefore;
    logger.debug(`[Gban] Added ${added} new user IDs to CAS cache (total: ${_casBanCache.size})`);
}

/**
 * Add a user to the local gban cache
 * @param {number} userId - User ID to add
 */
function addToLocalCache(userId) {
    if (!_localBanCache) _localBanCache = new Set();
    _localBanCache.add(Number(userId));
    logger.debug(`[Gban] Added user ${userId} to local gban cache (total: ${_localBanCache.size})`);
}

/**
 * Remove a user from the local gban cache
 * @param {number} userId - User ID to remove
 */
function removeFromLocalCache(userId) {
    if (_localBanCache) {
        _localBanCache.delete(Number(userId));
        logger.debug(`[Gban] Removed user ${userId} from local gban cache (total: ${_localBanCache.size})`);
    }
}

/**
 * Get cache size
 * @returns {{cas: number, local: number}}
 */
function getCacheSize() {
    return {
        cas: _casBanCache ? _casBanCache.size : 0,
        local: _localBanCache ? _localBanCache.size : 0
    };
}

/**
 * Reload cache from database
 */
async function reloadCache() {
    logger.info(`[Gban] Reloading gban cache...`);
    await loadCache();
}

module.exports = {
    init,
    isCasBanned,
    isLocallyBanned,
    isGloballyBanned,
    addToCache,
    addToLocalCache,
    removeFromLocalCache,
    getCacheSize,
    reloadCache
};
