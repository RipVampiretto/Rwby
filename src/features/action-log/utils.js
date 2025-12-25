/**
 * @fileoverview Utility e costanti per il modulo Action Log
 * @module features/action-log/utils
 *
 * @description
 * Contiene mappe di riferimento per i nomi dei moduli e gli emoji
 * associati a ciascun tipo di evento di log.
 */

/**
 * Verifica se l'utente è un amministratore del gruppo.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @returns {Promise<boolean>} True se l'utente è admin o creator
 */
async function isAdmin(ctx) {
    try {
        const member = await ctx.getChatMember(ctx.from.id);
        return ['creator', 'administrator'].includes(member.status);
    } catch (e) {
        return false;
    }
}

/**
 * Mappa dei nomi leggibili dei moduli per ogni tipo di evento.
 * @constant {Object.<string, string>}
 */
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
    gban_ban: 'Global Ban',
    mention_delete: 'Mention Filter',
    mention_ban: 'Mention Filter',
    mention_scam: 'Mention Filter',
    modal_delete: 'Pattern Monitor',
    modal_report: 'Pattern Monitor'
};

/**
 * Mappa degli emoji per ogni tipo di evento.
 * @constant {Object.<string, string>}
 */
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
    gban_ban: '🌍',
    mention_delete: '🗑️',
    mention_ban: '🚷',
    mention_scam: '⚠️',
    modal_delete: '🎭',
    modal_report: '🎭'
};

module.exports = {
    isAdmin,
    MODULE_MAP,
    EMOJI_MAP
};
