/**
 * Parse custom button configuration string
 * Format: Label,URL|Label2,URL;Label3,URL3
 * | = New Row
 * ; = New Button in same row
 * , = Separator between Label and URL
 * @param {string} configStr 
 * @returns {Array<Array<{text: string, url: string}>>}
 */
function parseButtonConfig(configStr) {
    if (!configStr) return [];

    const rows = configStr.split('|');
    const keyboard = [];

    for (const row of rows) {
        if (!row.trim()) continue;
        const buttons = [];
        const buttonDefs = row.split(';');

        for (const btnDef of buttonDefs) {
            const firstCommaIndex = btnDef.indexOf(',');
            if (firstCommaIndex === -1) continue;

            const text = btnDef.substring(0, firstCommaIndex).trim();
            const url = btnDef.substring(firstCommaIndex + 1).trim();

            if (text && url) {
                buttons.push({ text, url });
            }
        }

        if (buttons.length > 0) {
            keyboard.push(buttons);
        }
    }

    return keyboard;
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
