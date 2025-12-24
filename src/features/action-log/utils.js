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
    lang_delete: 'Language Monitor',
    lang_ban: 'Language Monitor',
    media_delete: 'Media Monitor',
    media_ban: 'Media Monitor',
    link_delete: 'Link Monitor',
    ai_delete: 'AI Moderation',
    ai_ban: 'AI Moderation',
    keyword_delete: 'Keyword Monitor',
    keyword_ban: 'Keyword Monitor',
    staff_ban: 'Staff Coordination',
    staff_delete: 'Staff Coordination',
    staff_dismiss: 'Staff Coordination',
    vote_ban: 'Vote Ban',
    vote_ban: 'Vote Ban',
    gban_ban: 'Global Ban',
    mention_delete: 'Mention Filter',
    mention_ban: 'Mention Filter',
    mention_scam: 'Mention Filter'
};

// Emoji map
const EMOJI_MAP = {
    lang_delete: '🌐',
    lang_ban: '🌐',
    media_delete: '🔞',
    media_ban: '🔞',
    link_delete: '🔗',
    ai_delete: '🤖',
    ai_ban: '🤖',
    keyword_delete: '🔤',
    keyword_ban: '🔤',
    staff_ban: '👮',
    staff_delete: '👮',
    staff_dismiss: '👮',
    vote_ban: '⚖️',
    vote_ban: '⚖️',
    gban_ban: '🌍',
    mention_delete: '🗑️',
    mention_ban: '🚷',
    mention_scam: '⚠️'
};

module.exports = {
    isAdmin,
    MODULE_MAP,
    EMOJI_MAP
};
