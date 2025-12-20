/**
 * Check if the user is an administrator
 * @param {object} ctx - Telegram context
 * @returns {Promise<boolean>}
 */
async function isAdmin(ctx) {
    try {
        const member = await ctx.getChatMember(ctx.from.id);
        return ['creator', 'administrator'].includes(member.status);
    } catch (e) {
        return false;
    }
}

// Module name map
const MODULE_MAP = {
    'lang_delete': 'Language Monitor',
    'lang_ban': 'Language Monitor',
    'nsfw_delete': 'NSFW Monitor',
    'nsfw_ban': 'NSFW Monitor',
    'link_delete': 'Link Monitor',
    'ai_delete': 'AI Moderation',
    'ai_ban': 'AI Moderation',
    'keyword_delete': 'Keyword Monitor',
    'keyword_ban': 'Keyword Monitor',
    'staff_ban': 'Staff Coordination',
    'staff_delete': 'Staff Coordination',
    'staff_ban': 'Staff Coordination', // Duplicate key in original, keeping it consistent
    'staff_delete': 'Staff Coordination', // Duplicate key in original
    'staff_dismiss': 'Staff Coordination',
    'vote_ban': 'Vote Ban'
};

// Emoji map
const EMOJI_MAP = {
    'lang_delete': '🌐', 'lang_ban': '🌐',
    'nsfw_delete': '🔞', 'nsfw_ban': '🔞',
    'link_delete': '🔗',
    'ai_delete': '🤖', 'ai_ban': '🤖',
    'keyword_delete': '🔤', 'keyword_ban': '🔤',
    'staff_ban': '👮', 'staff_delete': '👮', 'staff_dismiss': '👮',
    'vote_ban': '⚖️'
};

module.exports = {
    isAdmin,
    MODULE_MAP,
    EMOJI_MAP
};
