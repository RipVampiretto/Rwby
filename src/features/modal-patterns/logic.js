const logger = require('../../middlewares/logger');

let db = null;

// Cache for loaded modals (refresh every 5 minutes)
let modalCache = [];
let modalCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function init(database) {
    db = database;
}

function refreshCache() {
    modalCacheTime = 0;
    // Force reload by calling with wildcard
    if (db) {
        try {
            modalCache = db.getDb().prepare(
                "SELECT * FROM spam_modals WHERE enabled = 1"
            ).all();
            modalCacheTime = Date.now();
        } catch (e) {
            logger.error(`[modal-patterns] Failed to load modals: ${e.message}`);
            modalCache = [];
        }
    }
}

/**
 * Load modals for specified languages (with caching)
 */
function getModalsForLanguages(languages) {
    if (!db) return [];

    // Check cache existence and validity
    if (Date.now() - modalCacheTime < CACHE_TTL && modalCache.length > 0) {
        return modalCache.filter(m =>
            languages.includes(m.language) || m.language === '*'
        );
    }

    // Reload from DB if expired or empty
    refreshCache();

    return modalCache.filter(m =>
        languages.includes(m.language) || m.language === '*'
    );
}

function safeJsonParse(str, defaultVal) {
    try { return JSON.parse(str); } catch (e) { return defaultVal; }
}

/**
 * Check if a modal is enabled for a specific guild
 */
function isModalEnabledForGuild(guildId, modalId) {
    if (!db) return true;
    try {
        const override = db.getDb().prepare(
            "SELECT enabled FROM guild_modal_overrides WHERE guild_id = ? AND modal_id = ?"
        ).get(guildId, modalId);

        // No override = enabled by default
        if (!override) return true;
        return override.enabled === 1;
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
    if (text.length < 10) return null; // Skip very short messages

    // Get group's allowed languages
    let allowedLangs = ['en']; // Default
    try {
        const parsed = JSON.parse(config.allowed_languages || '[]');
        if (parsed.length > 0) allowedLangs = parsed;
    } catch (e) { }

    // Load modals (cached) and filter by guild overrides
    const modals = getModalsForLanguages(allowedLangs);
    const guildId = ctx.chat.id;

    for (const modal of modals) {
        if (!isModalEnabledForGuild(guildId, modal.id)) continue;

        const patterns = safeJsonParse(modal.patterns, []);
        for (const pattern of patterns) {
            const similarity = jaccardSimilarity(text, pattern.toLowerCase());

            if (similarity >= (modal.similarity_threshold || 0.6)) {
                return {
                    modal: modal,
                    category: modal.category,
                    action: config.modal_action || modal.action || 'report_only',
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
    getModalsForLanguages,
    isModalEnabledForGuild,
    checkMessageAgainstModals,
    safeJsonParse,
    jaccardSimilarity
};
