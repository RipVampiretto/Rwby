/**
 * ============================================================================
 * MENU OWNERSHIP MIDDLEWARE
 * ============================================================================
 * 
 * Restricts ALL inline keyboard interactions to group admins only.
 * This prevents regular users from clicking config buttons, closing menus, etc.
 */

const logger = require('./logger');

// Cache admin status per user/chat to avoid repeated API calls
// Key: `${chatId}:${userId}`, Value: { isAdmin: boolean, expires: timestamp }
const adminCache = new Map();
const CACHE_TTL = 60000; // 1 minute

/**
 * Check if user is admin (with caching)
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

/**
 * Cleanup expired cache entries periodically
 */
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of adminCache.entries()) {
        if (now >= value.expires) {
            adminCache.delete(key);
        }
    }
}, 60000);

/**
 * Middleware that restricts inline keyboard callbacks to admins only
 */
function adminOnlyCallbacks() {
    return async (ctx, next) => {
        // Only apply to callback queries
        if (!ctx.callbackQuery) {
            return next();
        }

        // Allow in private chats
        if (ctx.chat?.type === 'private') {
            return next();
        }

        // Check if user is admin
        const isAdmin = await isAdminCached(ctx);

        // Check whitelist first
        const allowedPrefixes = ['vote_'];
        if (allowedPrefixes.some(p => ctx.callbackQuery.data && ctx.callbackQuery.data.startsWith(p))) {
            return next();
        }

        if (!isAdmin) {
            logger.debug(`[menu-ownership] Blocked callback from non-admin ${ctx.from?.id} in ${ctx.chat?.id}`);
            await ctx.answerCallbackQuery({
                text: "⛔ Solo gli admin possono usare questo menu",
                show_alert: true
            });
            return; // Stop propagation
        }

        // User is admin, continue
        return next();
    };
}

module.exports = { adminOnlyCallbacks, isAdminCached };
