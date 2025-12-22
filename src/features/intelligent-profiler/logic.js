let db = null;

function init(database) {
    db = database;
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getScamPatterns() {
    if (!db) return [];
    const rows = await db.queryAll(
        "SELECT word, is_regex FROM word_filters WHERE guild_id = 0 AND category = 'scam_pattern'"
    );
    return rows.map(r => (r.is_regex ? new RegExp(r.word, 'i') : new RegExp(escapeRegExp(r.word), 'i')));
}

function extractLinks(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.match(urlRegex) || [];
}

async function scanMessage(ctx, config) {
    const text = ctx.message.text || ctx.message.caption || '';

    // 1. Link Check
    const links = extractLinks(text);
    if (links.length > 0) {
        let whitelist = [];
        if (db) {
            const whitelistRows = await db.queryAll(
                "SELECT value FROM intel_data WHERE type = 'global_whitelist_domain' AND status = 'active'"
            );
            whitelist = whitelistRows.map(r => r.value);
        }

        const isSafe = links.every(l => {
            try {
                return whitelist.some(w => new URL(l).hostname.endsWith(w));
            } catch (e) {
                return false;
            }
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
            content: '[Forwarded Message]'
        };
    }

    // 3. Pattern Check
    let patternScore = 0;
    const scamPatterns = await getScamPatterns();
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
