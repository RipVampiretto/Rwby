/**
 * @fileoverview Logica core per il modulo Link Filter
 * @module features/link-filter/logic
 *
 * @description
 * Contiene le funzioni per l'estrazione e il controllo dei link nei messaggi.
 * Supporta sia entità Telegram che rilevamento regex per domini senza protocollo.
 */

/**
 * Riferimento al database
 * @type {Object|null}
 * @private
 */
let db = null;

/**
 * Inizializza il modulo con il database.
 *
 * @param {Object} database - Istanza del database PostgreSQL
 */
function init(database) {
    db = database;
}

/**
 * Estrae i link da un messaggio Telegram.
 * Utilizza sia le entità Telegram che regex per massima copertura.
 *
 * @param {Object|string} message - Messaggio Telegram o stringa di testo
 * @returns {string[]} Array di URL trovati
 */
function extractLinks(message) {
    const links = [];

    // Gestisce sia oggetto messaggio che testo semplice (retrocompatibilità)
    if (typeof message === 'string') {
        return extractLinksFromText(message);
    }

    const text = message.text || message.caption || '';
    const entities = message.entities || message.caption_entities || [];

    for (const entity of entities) {
        if (entity.type === 'url') {
            // URL visibile - estrai dal testo
            const url = text.substring(entity.offset, entity.offset + entity.length);
            links.push(url);
        } else if (entity.type === 'text_link') {
            // URL nascosto (testo cliccabile) - usa entity.url
            links.push(entity.url);
        }
    }

    // Scansiona anche il testo con regex per domini senza protocollo
    const regexLinks = extractLinksFromText(text);
    for (const link of regexLinks) {
        if (!links.includes(link)) {
            links.push(link);
        }
    }

    return links;
}

/**
 * Estrae URL da testo semplice usando regex.
 * Cattura sia URL completi che domini senza protocollo.
 *
 * @param {string} text - Testo da analizzare
 * @returns {string[]} Array di URL trovati
 * @private
 */
function extractLinksFromText(text) {
    if (!text) return [];

    const links = [];

    // URL completi con protocollo
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const urlMatches = text.match(urlRegex) || [];
    links.push(...urlMatches);

    // Domini senza protocollo (es. palla.com, example.org)
    const domainRegex =
        /(?<![\\/\\w])([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:com|org|net|io|co|me|info|biz|xyz|online|site|app|dev|ru|ua|cn|de|uk|fr|it|es|nl|be|ch|at|pl|cz|hu|ro|bg|gr|tr|ir|in|jp|kr|tw|hk|sg|my|id|ph|th|vn|au|nz|br|ar|mx|cl|pe|za|ng|ke|eg|ma|tk|ml|ga|cf|gq|pw|ws|to|gg|tv|cc|la|ai|sh|sx|is|ly|vc|click|link|club|top|work|space|tech|store|shop|blog|life|live|world|today|news|press|media|expert|solutions|center|systems|group|agency|plus|pro|tips|guide|help|support|zone|team|watch|fund|capital|cash|money|finance|bank|trade|market|buy|sell|bet|casino|poker|game|games|fun|lol|wtf|red|blue|green|pink|black|cloud|email|web|host|page|land|one|win|vip|xxx|adult|porn|sex)(?![\\/\\w])/gi;
    const domainMatches = text.match(domainRegex) || [];

    for (const domain of domainMatches) {
        // Aggiungi prefisso http:// per far funzionare getDomain()
        const normalizedUrl = `http://${domain}`;
        if (!links.includes(normalizedUrl) && !links.includes(domain)) {
            links.push(normalizedUrl);
        }
    }

    return links;
}

/**
 * Verifica rapidamente se un messaggio contiene link.
 *
 * @param {Object|string} message - Messaggio Telegram o stringa di testo
 * @returns {boolean} True se contiene link
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

    // Fallback controllo regex
    const text = message.text || message.caption || '';
    return /(https?:\/\/[^\s]+)/.test(text);
}

/**
 * Estrae il dominio da un URL.
 *
 * @param {string} url - URL da analizzare
 * @returns {string|null} Dominio senza www., o null se parsing fallisce
 */
function getDomain(url) {
    try {
        const domain = new URL(url).hostname;
        return domain.replace(/^www\./, '');
    } catch (e) {
        return null;
    }
}

/**
 * Controlla un dominio nella whitelist/blacklist globale.
 * Verifica anche tutti i domini parent (es. sub.example.com → example.com).
 *
 * @param {string} domain - Dominio da verificare
 * @returns {Promise<'whitelist'|'blacklist'|'unknown'>} Stato del dominio
 */
async function checkIntel(domain) {
    if (!db) return 'unknown';

    // Costruisce lista domini da controllare: dominio completo + tutti i parent
    // es. "gigino.palla.com" -> ["gigino.palla.com", "palla.com"]
    const domainsToCheck = [];
    const parts = domain.split('.');

    for (let i = 0; i < parts.length - 1; i++) {
        domainsToCheck.push(parts.slice(i).join('.'));
    }

    // Controlla tutti i domini in una singola query per efficienza
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

/**
 * Scansiona un messaggio per link problematici.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @param {Object} config - Configurazione del gruppo
 * @returns {Promise<{type: string, domain: string, link: string}|null>} Risultato scansione
 */
async function scanMessage(ctx, config) {
    const links = extractLinks(ctx.message);
    if (links.length === 0) return null;

    for (const link of links) {
        const domain = getDomain(link);
        if (!domain) continue;

        // Usa sempre il controllo intel globale
        const intelCheck = await checkIntel(domain);

        if (intelCheck === 'whitelist') {
            continue;
        }

        if (intelCheck === 'blacklist') {
            return { type: 'blacklist', domain, link };
        }

        // Dominio sconosciuto - inoltra al Parliament per revisione
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
