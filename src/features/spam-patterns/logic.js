const logger = require('../../middlewares/logger');

let db = null;

// Cache for loaded modals (refresh every 5 minutes)
let modalCache = [];
let modalCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

function init(database) {
    db = database;
}

async function refreshCache() {
    modalCacheTime = 0;
    if (db) {
        try {
            modalCache = await db.queryAll('SELECT * FROM spam_patterns WHERE enabled = TRUE');
            modalCacheTime = Date.now();
        } catch (e) {
            logger.error(`[spam-patterns] Failed to load modals: ${e.message}`);
            modalCache = [];
        }
    }
}

/**
 * Load all modals (with caching)
 */
async function getAllModals() {
    if (!db) return [];

    if (Date.now() - modalCacheTime < CACHE_TTL && modalCache.length > 0) {
        return modalCache;
    }

    await refreshCache();

    return modalCache;
}

function safeJsonParse(str, defaultVal) {
    if (typeof str === 'object' && str !== null) return str;
    try {
        return JSON.parse(str);
    } catch (e) {
        return defaultVal;
    }
}

/**
 * Check if a modal is enabled for a specific guild
 */
async function isModalEnabledForGuild(guildId, modalId) {
    if (!db) return true;
    try {
        const override = await db.queryOne(
            'SELECT enabled FROM guild_pattern_overrides WHERE guild_id = $1 AND modal_id = $2',
            [guildId, modalId]
        );
        if (!override) return true;
        return override.enabled === true;
    } catch (e) {
        return true;
    }
}

/**
 * Jaccard Similarity - Token based comparison
 */
function jaccardSimilarity(text1, text2) {
    const tokens1 = new Set(text1.split(/\s+/).filter(t => t.length > 2));
    const tokens2 = new Set(text2.split(/\s+/).filter(t => t.length > 2));

    if (tokens1.size === 0 || tokens2.size === 0) return 0;

    const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
    const union = new Set([...tokens1, ...tokens2]);

    return intersection.size / union.size;
}

/**
 * Check message against loaded modals for the group's languages
 */
async function checkMessageAgainstModals(ctx, config) {
    const text = (ctx.message.text || '').toLowerCase().trim();
    if (text.length < 10) return null;

    // Check against ALL modals regardless of language
    const modals = await getAllModals();
    const guildId = ctx.chat.id;

    for (const modal of modals) {
        if (!(await isModalEnabledForGuild(guildId, modal.id))) continue;

        const patterns = safeJsonParse(modal.patterns, []);
        for (const pattern of patterns) {
            const similarity = jaccardSimilarity(text, pattern.toLowerCase());

            if (similarity >= (modal.similarity_threshold || 0.6)) {
                return {
                    modal: modal,
                    category: modal.category,
                    action: config.spam_patterns_action || modal.action || 'report_only',
                    pattern: pattern,
                    similarity: similarity
                };
            }
        }
    }

    return null;
}

module.exports = {
    init,
    refreshCache,
    getAllModals,
    isModalEnabledForGuild,
    checkMessageAgainstModals,
    safeJsonParse,
    jaccardSimilarity
};
