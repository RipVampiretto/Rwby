/**
 * Parse button configuration from database (JSONB)
 * Now stored directly as Telegram inline_keyboard format
 * @param {object|null} buttonsJson - The JSONB from database
 * @returns {Array<Array<{text: string, url: string}>>}
 */
function parseButtonConfig(buttonsJson) {
    if (!buttonsJson) return [];

    // If it's already parsed (JSONB comes as object from PostgreSQL)
    if (typeof buttonsJson === 'object') {
        // Could be { inline_keyboard: [...] } or just [...]
        if (buttonsJson.inline_keyboard) {
            return buttonsJson.inline_keyboard;
        }
        // If it's already the array format
        if (Array.isArray(buttonsJson)) {
            return buttonsJson;
        }
    }

    // Fallback: try to parse if it's somehow a string
    if (typeof buttonsJson === 'string') {
        try {
            const parsed = JSON.parse(buttonsJson);
            if (parsed.inline_keyboard) return parsed.inline_keyboard;
            if (Array.isArray(parsed)) return parsed;
        } catch (e) {
            return [];
        }
    }

    return [];
}

/**
 * Replace wildcards in text
 * @param {string} text 
 * @param {object} user 
 * @param {object} chat 
 * @returns {string}
 */
function replaceWildcards(text, user, chat) {
    if (!text) return '';

    let processed = text;

    // --- User Data ---
    const mention = `<a href="tg://user?id=${user.id}">${user.first_name}</a>`;
    const username = user.username ? `@${user.username}` : '-';

    processed = processed.replace(/{mention}/g, mention);
    processed = processed.replace(/{user}/g, user.first_name); // Visual name
    processed = processed.replace(/{username}/g, username);
    processed = processed.replace(/{first_name}/g, user.first_name);
    processed = processed.replace(/{last_name}/g, user.last_name || '');
    processed = processed.replace(/{id}/g, user.id);

    // Legacy support (optional, can remove if strict)
    processed = processed.replace(/{fullname}/g, [user.first_name, user.last_name].filter(Boolean).join(' '));


    // --- Group Data ---
    const chatTitle = chat.title || 'Group';
    const chatUsername = chat.username ? `@${chat.username}` : '-';
    // If public, linkable. If private, just title (or could use chat_id link if user is member? No reliable way).
    const mentionGroup = chat.username
        ? `<a href="https://t.me/${chat.username}">${chatTitle}</a>`
        : `<b>${chatTitle}</b>`;

    processed = processed.replace(/{mention_group}/g, mentionGroup);
    processed = processed.replace(/{chat_title}/g, chatTitle);
    processed = processed.replace(/{chat_username}/g, chatUsername);
    processed = processed.replace(/{chat_id}/g, chat.id);
    processed = processed.replace(/{group_name}/g, chatTitle); // Legacy alias


    // --- Special Functions ---
    // {Text|URL} -> <a href="URL">Text</a>
    // Regex matches {Content|Content}
    // We use a non-greedy match for content
    processed = processed.replace(/{([^|}]+)\|([^}]+)}/g, (match, label, url) => {
        return `<a href="${url}">${label}</a>`;
    });

    return processed;
}

module.exports = {
    parseButtonConfig,
    replaceWildcards
};
