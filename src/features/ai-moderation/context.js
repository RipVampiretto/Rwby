// In-memory context storage: Map<chatId, Array<{userId, text, ts}>>
const CONTEXT_BUFFER = new Map();
const MAX_CONTEXT_SIZE = 10; // Keep last 10 messages per chat

/**
 * Middleware to collect message context
 * @param {object} bot - Bot instance
 */
function registerContextMiddleware(bot) {
    bot.on("message:text", async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Store message in context buffer
        const chatId = ctx.chat.id;
        if (!CONTEXT_BUFFER.has(chatId)) {
            CONTEXT_BUFFER.set(chatId, []);
        }
        const buffer = CONTEXT_BUFFER.get(chatId);
        buffer.push({
            userId: ctx.from.id,
            username: ctx.from.username || ctx.from.first_name,
            text: ctx.message.text,
            ts: Date.now()
        });
        // Keep only last MAX_CONTEXT_SIZE messages
        if (buffer.length > MAX_CONTEXT_SIZE) {
            buffer.shift();
        }

        await next();
    });
}

/**
 * Get context messages for a chat
 * @param {number} chatId - Chat ID
 * @param {number} lim - Number of messages to retrieve
 * @returns {Array} Context messages
 */
function getContext(chatId, lim) {
    const buffer = CONTEXT_BUFFER.get(chatId) || [];
    // Get last N messages excluding current one (assume called when needed)
    return buffer.slice(-lim - 1, -1);
}

module.exports = {
    registerContextMiddleware,
    getContext
};
