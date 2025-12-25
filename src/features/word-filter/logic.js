let db = null;

function init(database) {
    db = database;
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function scanMessage(ctx) {
    if (!db) return null;

    const text = ctx.message.text;

    // Only check global word filters
    const rules = await db.queryAll('SELECT * FROM word_filters');

    for (const rule of rules) {
        let match = false;
        if (rule.is_regex) {
            try {
                const regex = new RegExp(rule.word, 'i');
                if (regex.test(text)) match = true;
            } catch (e) {}
        } else {
            if (rule.match_whole_word) {
                const regex = new RegExp(`\\b${escapeRegExp(rule.word)}\\b`, 'i');
                if (regex.test(text)) match = true;
            } else {
                if (text.toLowerCase().includes(rule.word.toLowerCase())) match = true;
            }
        }

        if (match) {
            return { word: rule.word };
        }
    }
    return null;
}

module.exports = {
    init,
    scanMessage,
    escapeRegExp
};
