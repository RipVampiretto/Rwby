const axios = require('axios');
const logger = require('../middlewares/logger');

const BRIDGE_URL = 'http://localhost:3333/search';

/**
 * Perform a web search using the local bridge service.
 * @param {string} query - The search query.
 * @returns {Promise<Array<{title: string, link: string, snippet: string}>>}
 */
async function searchWeb(query) {
    try {
        const response = await axios.get(BRIDGE_URL, {
            params: { q: query },
            timeout: 10000
        });

        const rawResults = response.data;

        if (!Array.isArray(rawResults)) {
            return [];
        }

        // Normalize results
        return rawResults.map(r => ({
            title: r.title || 'No Title',
            link: r.url || r.link || '#',
            snippet: r.description || r.snippet || r.content || r.body || '',
            full_content: r.full_content || null
        }));

    } catch (e) {
        // Don't log full error stack for connection refused (bridge not running)
        if (e.code === 'ECONNREFUSED') {
            logger.warn(`[SearchClient] Bridge not running at ${BRIDGE_URL}`);
        } else {
            logger.error(`[SearchClient] Search failed: ${e.message}`);
        }
        return [];
    }
}

module.exports = {
    searchWeb
};
