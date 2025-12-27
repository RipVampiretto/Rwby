const logger = require('../../middlewares/logger');

let db = null;

function init(database) {
    db = database;
    logger.info(`[WordFilter] Module initialized`);
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function scanMessage(ctx) {
    if (!db) {
        logger.debug(`[WordFilter] Database not initialized, skipping scan`);
        return null;
    }

    const text = ctx.message.text;
    logger.debug(`[WordFilter] Scanning message: "${text.substring(0, 50)}..."`, ctx);

    // Only check global word filters
    const rules = await db.queryAll('SELECT * FROM word_filters');
    logger.debug(`[WordFilter] Checking against ${rules.length} word filter rules`, ctx);

    for (const rule of rules) {
        let match = false;
        if (rule.is_regex) {
            try {
                const regex = new RegExp(rule.word, 'i');
                if (regex.test(text)) match = true;
            } catch (e) {
                logger.warn(`[WordFilter] Invalid regex pattern: ${rule.word}`, ctx);
            }
        } else {
            if (rule.match_whole_word) {
                const regex = new RegExp(`\\b${escapeRegExp(rule.word)}\\b`, 'i');
                if (regex.test(text)) match = true;
            } else {
                if (text.toLowerCase().includes(rule.word.toLowerCase())) match = true;
            }
        }

        if (match) {
            logger.info(`[WordFilter] MATCH FOUND: word="${rule.word}", isRegex=${rule.is_regex}`, ctx);
            return { word: rule.word };
        }
    }

    logger.debug(`[WordFilter] No matches found`, ctx);
    return null;
}

module.exports = {
    init,
    scanMessage,
    escapeRegExp
};

