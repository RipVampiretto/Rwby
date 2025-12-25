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
 * Normalize text for comparison:
 * - Lowercase
 * - Remove punctuation
 * - Normalize whitespace
 */
function normalizeText(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')  // Replace punctuation with spaces
        .replace(/\s+/g, ' ')       // Normalize multiple spaces
        .trim();
}

/**
 * Dice Similarity Coefficient - More generous than Jaccard for partial matches
 * Formula: 2 * |intersection| / (|A| + |B|)
 * Keeps all tokens (no length filter) for better accuracy
 */
function diceSimilarity(text1, text2) {
    const normalized1 = normalizeText(text1);
    const normalized2 = normalizeText(text2);

    const tokens1 = new Set(normalized1.split(/\s+/).filter(t => t.length > 0));
    const tokens2 = new Set(normalized2.split(/\s+/).filter(t => t.length > 0));

    if (tokens1.size === 0 || tokens2.size === 0) return 0;

    const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));

    // Dice: 2 * intersection / (size1 + size2)
    return (2 * intersection.size) / (tokens1.size + tokens2.size);
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
            const similarity = diceSimilarity(text, pattern);

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
    diceSimilarity,
    normalizeText
};
