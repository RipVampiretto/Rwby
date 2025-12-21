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
    const rules = await db.queryAll(
        'SELECT * FROM word_filters WHERE guild_id = $1 OR guild_id = 0',
        [ctx.chat.id]
    );

    for (const rule of rules) {
        if (rule.bypass_tier && ctx.userTier >= rule.bypass_tier) continue;

        let match = false;
        if (rule.is_regex) {
            try {
                const regex = new RegExp(rule.word, 'i');
                if (regex.test(text)) match = true;
            } catch (e) { }
        } else {
            if (rule.match_whole_word) {
                const regex = new RegExp(`\\b${escapeRegExp(rule.word)}\\b`, 'i');
                if (regex.test(text)) match = true;
            } else {
                if (text.toLowerCase().includes(rule.word.toLowerCase())) match = true;
            }
        }

        if (match) {
            return {
                action: rule.action,
                word: rule.word,
                fullText: text
            };
        }
    }
    return null;
}

module.exports = {
    init,
    scanMessage,
    escapeRegExp
};
