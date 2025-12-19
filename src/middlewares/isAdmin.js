const logger = require('./logger');

/**
 * Middleware to check if the user is an admin or creator of the chat.
 * Applicable mainly for groups/channels.
 */
async function isAdmin(ctx, next) {
    if (!ctx.from || !ctx.chat) return next();

    // Always allow in private chats
    if (ctx.chat.type === 'private') {
        return next();
    }

    try {
        const member = await ctx.getChatMember(ctx.from.id);
        if (['creator', 'administrator'].includes(member.status)) {
            return next();
        } else {
            // Optional: Reply or just ignore
            // await ctx.reply("⛔️ Questa azione è riservata agli amministratori.");
            // For now, we just stop propagation without reply to avoid spamming
            return;
        }
    } catch (e) {
        logger.error(`Error in isAdmin middleware: ${e.message}`);
        // Fail safe: allow or block? Better block if unsure for sensitive ops, 
        // but for general use maybe just log.
        return;
    }
}

module.exports = isAdmin;
