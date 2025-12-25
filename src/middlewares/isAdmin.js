/**
 * @fileoverview Middleware per verifica status admin
 * @module middlewares/isAdmin
 *
 * @description
 * Middleware grammY che verifica se l'utente è un admin o creator del gruppo.
 * Se l'utente non è admin, la richiesta viene bloccata senza risposta.
 *
 * @requires ./logger
 */

const logger = require('./logger');

/**
 * Middleware per verificare se l'utente è admin.
 * Blocca silenziosamente le richieste da non-admin nei gruppi.
 * Permette sempre l'accesso nelle chat private.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @param {Function} next - Funzione next middleware
 * @returns {Promise<void>}
 */
async function isAdmin(ctx, next) {
    if (!ctx.from || !ctx.chat) return next();

    // Permetti sempre nelle chat private
    if (ctx.chat.type === 'private') {
        return next();
    }

    try {
        const member = await ctx.getChatMember(ctx.from.id);
        if (['creator', 'administrator'].includes(member.status)) {
            return next();
        } else {
            // Blocca silenziosamente senza risposta per evitare spam
            return;
        }
    } catch (e) {
        logger.error(`Error in isAdmin middleware: ${e.message}`);
        // Fail safe: blocca in caso di errore
        return;
    }
}

module.exports = isAdmin;
