/**
 * @fileoverview Middleware per controllo ownership menu inline
 * @module middlewares/menu-ownership
 *
 * @description
 * Restringe TUTTE le interazioni con tastiere inline solo agli admin.
 * Impedisce agli utenti normali di cliccare pulsanti di configurazione,
 * chiudere menu, ecc.
 *
 * Include cache degli admin per evitare chiamate API ripetute.
 *
 * @requires ./logger
 */

const logger = require('./logger');

/**
 * Cache status admin per utente/chat.
 * Chiave: `${chatId}:${userId}`
 * Valore: `{ isAdmin: boolean, expires: timestamp }`
 * @type {Map<string, {isAdmin: boolean, expires: number}>}
 * @private
 */
const adminCache = new Map();

/**
 * Durata cache in millisecondi (1 minuto).
 * @constant {number}
 */
const CACHE_TTL = 60000;

/**
 * Verifica se l'utente è admin (con caching).
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @returns {Promise<boolean>} True se admin
 */
async function isAdminCached(ctx) {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;

    if (!chatId || !userId) return false;

    const cacheKey = `${chatId}:${userId}`;
    const cached = adminCache.get(cacheKey);

    if (cached && Date.now() < cached.expires) {
        return cached.isAdmin;
    }

    try {
        const member = await ctx.getChatMember(userId);
        const isAdmin = ['creator', 'administrator'].includes(member.status);

        adminCache.set(cacheKey, {
            isAdmin,
            expires: Date.now() + CACHE_TTL
        });

        return isAdmin;
    } catch (e) {
        logger.debug(`[menu-ownership] Failed to check admin status: ${e.message}`);
        return false;
    }
}

// Pulizia periodica cache scadute
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of adminCache.entries()) {
        if (now >= value.expires) {
            adminCache.delete(key);
        }
    }
}, 60000);

/**
 * Middleware che restringe i callback inline solo agli admin.
 * Whitelist alcuni prefissi per votazioni pubbliche.
 *
 * @returns {import('grammy').MiddlewareFn} Middleware grammY
 */
function adminOnlyCallbacks() {
    return async (ctx, next) => {
        // Applica solo ai callback query
        if (!ctx.callbackQuery) {
            return next();
        }

        // Permetti nelle chat private
        if (ctx.chat?.type === 'private') {
            return next();
        }

        // Controlla whitelist per callback pubblici (votazioni)
        const allowedPrefixes = ['vote_', 'vb_confirm:', 'wc:'];
        if (allowedPrefixes.some(p => ctx.callbackQuery.data && ctx.callbackQuery.data.startsWith(p))) {
            return next();
        }

        // Verifica se l'utente è admin
        const isAdmin = await isAdminCached(ctx);

        if (!isAdmin) {
            logger.debug(`[menu-ownership] Blocked callback from non-admin ${ctx.from?.id} in ${ctx.chat?.id}`);
            await ctx.answerCallbackQuery({
                text: '⛔ Solo gli admin possono usare questo menu',
                show_alert: true
            });
            return; // Blocca propagazione
        }

        // Utente è admin, continua
        return next();
    };
}

module.exports = { adminOnlyCallbacks, isAdminCached };
