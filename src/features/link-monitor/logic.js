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

async function checkIntel(domain) {
    if (!db) return 'unknown';
    const res = await db.queryOne(
        `
        SELECT type FROM intel_data 
        WHERE (type = 'whitelist_domain' OR type = 'blacklist_domain') 
        AND value = $1 AND status = 'active'
    `,
        [domain]
    );

    if (res) {
        return res.type === 'whitelist_domain' ? 'whitelist' : 'blacklist';
    }
    return 'unknown';
}

async function scanMessage(ctx, config) {
    const links = extractLinks(ctx.message.text);
    if (links.length === 0) return null;

    for (const link of links) {
        const domain = getDomain(link);
        if (!domain) continue;

        if (config.link_sync_global) {
            const intelCheck = await checkIntel(domain);

            if (intelCheck === 'whitelist') {
                continue;
            }

            if (intelCheck === 'blacklist') {
                return { type: 'blacklist', domain, link };
            }
        }

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
