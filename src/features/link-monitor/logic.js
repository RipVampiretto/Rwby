let db = null;

function init(database) {
    db = database;
}

function extractLinks(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.match(urlRegex) || [];
}

function getDomain(url) {
    try {
        const domain = new URL(url).hostname;
        return domain.replace(/^www\./, '');
    } catch (e) {
        return null;
    }
}

function checkIntel(domain) {
    if (!db) return 'unknown';
    // Check intel_data for domain
    const res = db.getDb().prepare(`
        SELECT type FROM intel_data 
        WHERE (type = 'whitelist_domain' OR type = 'blacklist_domain') 
        AND value = ? AND status = 'active'
    `).get(domain);

    if (res) {
        return res.type === 'whitelist_domain' ? 'whitelist' : 'blacklist';
    }
    return 'unknown';
}

/**
 * Scan message for links and verify against Intel Network
 * @param {object} ctx 
 * @param {object} config 
 * @returns {object|null} Verdict { type: 'blacklist'|'unknown', domain, link } or null if safe/no links
 */
async function scanMessage(ctx, config) {
    const links = extractLinks(ctx.message.text);
    if (links.length === 0) return null;

    for (const link of links) {
        const domain = getDomain(link);
        if (!domain) continue;

        // Check Global Intel only if sync is enabled
        if (config.link_sync_global) {
            const intelCheck = checkIntel(domain);

            if (intelCheck === 'whitelist') {
                continue; // Safe
            }

            if (intelCheck === 'blacklist') {
                return { type: 'blacklist', domain, link };
            }
        }

        // If not blacklisted/whitelisted (or sync off), it's unknown
        return { type: 'unknown', domain, link };
    }

    return null;
}

module.exports = {
    init,
    extractLinks,
    getDomain,
    checkIntel,
    scanMessage
};
