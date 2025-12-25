let db = null;

function init(database) {
    db = database;
}

/**
 * Extract links from a message using Telegram entities (more reliable than regex)
 * Catches both visible URLs and hidden text_links
 * Also detects domains without protocol (e.g. palla.com)
 * @param {Object} message - The Telegram message object (ctx.message)
 * @returns {string[]} - Array of URLs found
 */
function extractLinks(message) {
    const links = [];

    // Handle both message object and plain text (backward compatibility)
    if (typeof message === 'string') {
        return extractLinksFromText(message);
    }

    const text = message.text || message.caption || '';
    const entities = message.entities || message.caption_entities || [];

    for (const entity of entities) {
        if (entity.type === 'url') {
            // Visible URL - extract from text
            const url = text.substring(entity.offset, entity.offset + entity.length);
            links.push(url);
        } else if (entity.type === 'text_link') {
            // Hidden URL (clickable text) - use entity.url
            links.push(entity.url);
        }
    }

    // Also scan text with regex to catch domains without protocol that Telegram didn't detect
    const regexLinks = extractLinksFromText(text);
    for (const link of regexLinks) {
        if (!links.includes(link)) {
            links.push(link);
        }
    }

    return links;
}

/**
 * Extract URLs from plain text using regex
 * Catches both full URLs and bare domains (e.g. palla.com)
 * @param {string} text
 * @returns {string[]}
 */
function extractLinksFromText(text) {
    if (!text) return [];

    const links = [];

    // Full URLs with protocol
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const urlMatches = text.match(urlRegex) || [];
    links.push(...urlMatches);

    // Bare domains without protocol (e.g. palla.com, example.org)
    // Common TLDs: com, org, net, io, co, me, info, biz, xyz, online, site, etc.
    const domainRegex =
        /(?<![\/\w])([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:com|org|net|io|co|me|info|biz|xyz|online|site|app|dev|ru|ua|cn|de|uk|fr|it|es|nl|be|ch|at|pl|cz|hu|ro|bg|gr|tr|ir|in|jp|kr|tw|hk|sg|my|id|ph|th|vn|au|nz|br|ar|mx|cl|pe|za|ng|ke|eg|ma|tk|ml|ga|cf|gq|pw|ws|to|gg|tv|cc|la|ai|sh|sx|is|ly|vc|click|link|club|top|work|space|tech|store|shop|blog|life|live|world|today|news|press|media|expert|solutions|center|systems|group|agency|plus|pro|tips|guide|help|support|zone|team|watch|fund|capital|cash|money|finance|bank|trade|market|buy|sell|bet|casino|poker|game|games|fun|lol|wtf|red|blue|green|pink|black|cloud|email|web|host|page|land|one|win|vip|xxx|adult|porn|sex)(?![\/\w])/gi;
    const domainMatches = text.match(domainRegex) || [];

    for (const domain of domainMatches) {
        // Add http:// prefix for getDomain() to work
        const normalizedUrl = `http://${domain}`;
        if (!links.includes(normalizedUrl) && !links.includes(domain)) {
            links.push(normalizedUrl);
        }
    }

    return links;
}

/**
 * Check if a message contains any links (fast boolean check)
 * @param {Object} message - The Telegram message object
 * @returns {boolean}
 */
function hasLinks(message) {
    if (typeof message === 'string') {
        return /(https?:\/\/[^\s]+)/.test(message);
    }

    const entities = message.entities || message.caption_entities || [];
    for (const entity of entities) {
        if (entity.type === 'url' || entity.type === 'text_link') {
            return true;
        }
    }

    // Fallback regex check
    const text = message.text || message.caption || '';
    return /(https?:\/\/[^\s]+)/.test(text);
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

    // Build list of domains to check: full domain + all parent domains
    // e.g. "gigino.palla.com" -> ["gigino.palla.com", "palla.com"]
    const domainsToCheck = [];
    const parts = domain.split('.');

    for (let i = 0; i < parts.length - 1; i++) {
        domainsToCheck.push(parts.slice(i).join('.'));
    }

    // Check all domains in a single query for efficiency
    const res = await db.queryOne(
        `
        SELECT pattern, action FROM link_rules 
        WHERE type = 'domain' AND pattern = ANY($1)
        ORDER BY LENGTH(pattern) DESC
        LIMIT 1
    `,
        [domainsToCheck]
    );

    if (res) {
        return res.action === 'allow' ? 'whitelist' : 'blacklist';
    }
    return 'unknown';
}

async function scanMessage(ctx, config) {
    const links = extractLinks(ctx.message);
    if (links.length === 0) return null;

    for (const link of links) {
        const domain = getDomain(link);
        if (!domain) continue;

        // Always use global intel check
        const intelCheck = await checkIntel(domain);

        if (intelCheck === 'whitelist') {
            continue;
        }

        if (intelCheck === 'blacklist') {
            return { type: 'blacklist', domain, link };
        }

        // Unknown domain - forward to Parliament for review
        return { type: 'unknown', domain, link };
    }

    return null;
}

module.exports = {
    init,
    extractLinks,
    hasLinks,
    getDomain,
    checkIntel,
    scanMessage
};
