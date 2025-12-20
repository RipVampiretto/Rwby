let db = null;

function init(database) {
    db = database;
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

// Heuristic scam patterns - loaded from DB
function getScamPatterns() {
    if (!db) return [];
    const rows = db.getDb().prepare(
        "SELECT word, is_regex FROM word_filters WHERE guild_id = 0 AND category = 'scam_pattern'"
    ).all();
    return rows.map(r => r.is_regex ? new RegExp(r.word, 'i') : new RegExp(escapeRegExp(r.word), 'i'));
}

function extractLinks(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.match(urlRegex) || [];
}

/**
 * Scan a message for Tier 0 violations.
 * @param {object} ctx - Telegram context
 * @param {object} config - Guild config
 * @returns {object|null} - Violation detected { action, reason, content } or null
 */
async function scanMessage(ctx, config) {
    const text = ctx.message.text || ctx.message.caption || "";

    // 1. Link Check
    const links = extractLinks(text);
    if (links.length > 0) {
        // Unknown links from Tier 0 are suspicious
        // Logic: if not whitelisted locally or globally -> SUSPICIOUS
        // Load whitelist from database (global entries have guild_id = 0)
        let whitelist = [];
        if (db) {
            const whitelistRows = db.getDb().prepare(
                "SELECT value FROM intel_data WHERE type = 'global_whitelist_domain' AND status = 'active'"
            ).all();
            whitelist = whitelistRows.map(r => r.value);
        }

        const isSafe = links.every(l => {
            try { return whitelist.some(w => new URL(l).hostname.endsWith(w)); } catch (e) { return false; }
        });

        if (!isSafe) {
            return {
                action: config.profiler_action_link || 'delete',
                reason: 'Tier 0 Link',
                content: text
            };
        }
    }

    // 2. Forward Check
    if (ctx.message.forward_from || ctx.message.forward_from_chat) {
        return {
            action: config.profiler_action_forward || 'delete',
            reason: 'Tier 0 Forward',
            content: "[Forwarded Message]"
        };
    }

    // 3. Pattern Check
    let patternScore = 0;
    const scamPatterns = getScamPatterns();
    for (const p of scamPatterns) {
        if (p.test(text)) patternScore++;
    }

    if (patternScore >= 2) {
        return {
            action: config.profiler_action_pattern || 'report_only',
            reason: `Scam Pattern (Score ${patternScore})`,
            content: text
        };
    }

    return null;
}

module.exports = {
    init,
    scanMessage,
    extractLinks,
    getScamPatterns,
    escapeRegExp
};
