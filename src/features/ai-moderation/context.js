// In-memory context storage: Map<chatId, Array<{userId, text, ts, messageId, hasMedia, mediaType}>>
const CONTEXT_BUFFER = new Map();
const MAX_CONTEXT_SIZE = 20; // Keep last 20 messages per chat (for Smart Report)

/**
 * Middleware to collect message context (text + media)
 * @param {object} bot - Bot instance
 */
function registerContextMiddleware(bot) {
    // Handle text messages
    bot.on("message:text", async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();
        addToBuffer(ctx, ctx.message.text, null);
        await next();
    });

    // Handle photos
    bot.on("message:photo", async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();
        const caption = ctx.message.caption || '';
        addToBuffer(ctx, caption, 'photo');
        await next();
    });

    // Handle videos
    bot.on("message:video", async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();
        const caption = ctx.message.caption || '';
        addToBuffer(ctx, caption, 'video');
        await next();
    });

    // Handle animations/GIFs
    bot.on("message:animation", async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();
        const caption = ctx.message.caption || '';
        addToBuffer(ctx, caption, 'animation');
        await next();
    });

    // Handle stickers
    bot.on("message:sticker", async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();
        addToBuffer(ctx, '', 'sticker');
        await next();
    });
}

/**
 * Add message to buffer
 */
function addToBuffer(ctx, text, mediaType) {
    const chatId = ctx.chat.id;
    if (!CONTEXT_BUFFER.has(chatId)) {
        CONTEXT_BUFFER.set(chatId, []);
    }
    const buffer = CONTEXT_BUFFER.get(chatId);
    buffer.push({
        messageId: ctx.message.message_id,
        userId: ctx.from.id,
        username: ctx.from.username || ctx.from.first_name,
        text: text,
        hasMedia: !!mediaType,
        mediaType: mediaType,
        ts: Date.now()
    });
    // Keep only last MAX_CONTEXT_SIZE messages
    if (buffer.length > MAX_CONTEXT_SIZE) {
        buffer.shift();
    }
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
