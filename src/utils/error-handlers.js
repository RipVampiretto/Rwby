/**
 * ============================================================================
 * ERROR HANDLERS - Utility functions for consistent error handling
 * ============================================================================
 *
 * Provides safe wrappers for common Telegram operations that may fail,
 * with proper logging and context.
 */

const logger = require('../middlewares/logger');

/**
 * Log non-critical errors (delete failed, edit failed, etc.)
 * These are expected to fail sometimes (e.g., message already deleted)
 * @param {string} module - Module name (e.g., 'anti-spam')
 * @param {string} action - Action being performed (e.g., 'deleteMessage')
 * @param {Error} error - The caught error
 * @param {object} ctx - Optional grammY context for additional info
 */
function handleTelegramError(module, action, error, ctx = null) {
    const userId = ctx?.from?.id || 'N/A';
    const chatId = ctx?.chat?.id || 'N/A';
    logger.debug(`[${module}] ${action} failed - User:${userId} Chat:${chatId} - ${error.message}`);
}

/**
 * Log critical errors that require attention
 * @param {string} module - Module name
 * @param {string} action - Action being performed
 * @param {Error} error - The caught error
 * @param {object} ctx - Optional grammY context
 */
function handleCriticalError(module, action, error, ctx = null) {
    const userId = ctx?.from?.id || 'N/A';
    const chatId = ctx?.chat?.id || 'N/A';
    const chatName = ctx?.chat?.title || 'N/A';
    logger.error(`[${module}] CRITICAL: ${action} - User:${userId} Chat:${chatId} (${chatName}) - ${error.message}`);
}

/**
 * Safe JSON parse that never throws
 * @param {string} str - JSON string to parse
 * @param {*} fallback - Fallback value if parse fails (default: null)
 * @returns {*} Parsed object or fallback
 */
function safeJsonParse(str, fallback = null) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return fallback;
    }
}

/**
 * Safely delete a message, logging if it fails
 * @param {object} ctx - grammY context
 * @param {string} module - Module name for logging (default: 'unknown')
 * @returns {Promise<boolean>} True if deleted, false if failed
 */
async function safeDelete(ctx, module = 'unknown') {
    try {
        await ctx.deleteMessage();
        return true;
    } catch (e) {
        handleTelegramError(module, 'deleteMessage', e, ctx);
        return false;
    }
}

/**
 * Safely edit a message text, logging if it fails
 * @param {object} ctx - grammY context
 * @param {string} text - New message text
 * @param {object} options - Edit options (reply_markup, parse_mode, etc.)
 * @param {string} module - Module name for logging (default: 'unknown')
 * @returns {Promise<boolean>} True if edited, false if failed
 */
async function safeEdit(ctx, text, options = {}, module = 'unknown') {
    try {
        await ctx.editMessageText(text, options);
        return true;
    } catch (e) {
        if (e.error_code === 429) {
            try {
                await ctx.answerCallbackQuery('⚠️ Slow down!');
            } catch (ignore) {}
            return false;
        }
        handleTelegramError(module, 'editMessageText', e, ctx);
        return false;
    }
}

/**
 * Safely ban a chat member
 * @param {object} ctx - grammY context
 * @param {number} userId - User ID to ban
 * @param {string} module - Module name for logging
 * @returns {Promise<boolean>} True if banned, false if failed
 */
async function safeBan(ctx, userId, module = 'unknown') {
    try {
        await ctx.banChatMember(userId);
        return true;
    } catch (e) {
        handleCriticalError(module, 'banChatMember', e, ctx);
        return false;
    }
}

/**
 * Safely get chat member status
 * @param {object} ctx - grammY context
 * @param {number} userId - User ID to check
 * @param {string} module - Module name for logging
 * @returns {Promise<object|null>} Member object or null if failed
 */
async function safeGetChatMember(ctx, userId, module = 'unknown') {
    try {
        return await ctx.getChatMember(userId);
    } catch (e) {
        handleTelegramError(module, 'getChatMember', e, ctx);
        return null;
    }
}

/**
 * Check if user is admin (creator or administrator)
 * @param {object} ctx - grammY context
 * @param {string} module - Module name for logging
 * @returns {Promise<boolean>} True if admin, false otherwise
 */
async function isAdmin(ctx, module = 'unknown') {
    const member = await safeGetChatMember(ctx, ctx.from.id, module);
    if (!member) return false;
    return ['creator', 'administrator'].includes(member.status);
}

/**
 * Check if callback query came from settings menu
 * Detects if the current keyboard contains a "settings_main" back button
 * @param {object} ctx - grammY callback query context
 * @returns {boolean} True if came from settings menu
 */
function isFromSettingsMenu(ctx) {
    try {
        const markup = ctx.callbackQuery?.message?.reply_markup;
        if (markup && markup.inline_keyboard) {
            return markup.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'settings_main'));
        }
    } catch (e) {
        /* ignore */
    }
    return false;
}

/**
 * Check if user ID is a super admin
 * @param {number} userId - User ID to check
 * @returns {boolean} True if super admin
 */
function isSuperAdmin(userId) {
    const superAdminIds = (process.env.SUPER_ADMIN_IDS || '')
        .split(',')
        .map(id => parseInt(id.trim(), 10))
        .filter(id => !isNaN(id));
    return superAdminIds.includes(userId);
}

module.exports = {
    handleTelegramError,
    handleCriticalError,
    safeJsonParse,
    safeDelete,
    safeEdit,
    safeBan,
    safeGetChatMember,
    isAdmin,
    isFromSettingsMenu,
    isSuperAdmin
};
