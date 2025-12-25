/**
 * @fileoverview Utility per gestione errori e operazioni sicure
 * @module utils/error-handlers
 *
 * @description
 * Fornisce wrapper sicuri per operazioni Telegram che possono fallire,
 * con logging appropriato. Le funzioni "safe*" non lanciano eccezioni
 * ma restituiscono booleani o valori di fallback.
 *
 * @requires ../middlewares/logger
 */

const logger = require('../middlewares/logger');

/**
 * Logga errori non critici (delete fallito, edit fallito, etc.).
 * Questi errori sono attesi a volte (es. messaggio già eliminato).
 *
 * @param {string} module - Nome del modulo (es. 'anti-spam')
 * @param {string} action - Azione in corso (es. 'deleteMessage')
 * @param {Error} error - Errore catturato
 * @param {import('grammy').Context|null} [ctx=null] - Contesto grammY opzionale
 */
function handleTelegramError(module, action, error, ctx = null) {
    const userId = ctx?.from?.id || 'N/A';
    const chatId = ctx?.chat?.id || 'N/A';
    logger.debug(`[${module}] ${action} failed - User:${userId} Chat:${chatId} - ${error.message}`);
}

/**
 * Logga errori critici che richiedono attenzione.
 *
 * @param {string} module - Nome del modulo
 * @param {string} action - Azione in corso
 * @param {Error} error - Errore catturato
 * @param {import('grammy').Context|null} [ctx=null] - Contesto grammY opzionale
 */
function handleCriticalError(module, action, error, ctx = null) {
    const userId = ctx?.from?.id || 'N/A';
    const chatId = ctx?.chat?.id || 'N/A';
    const chatName = ctx?.chat?.title || 'N/A';
    logger.error(`[${module}] CRITICAL: ${action} - User:${userId} Chat:${chatId} (${chatName}) - ${error.message}`);
}

/**
 * Parse JSON sicuro che non lancia mai eccezioni.
 *
 * @param {string} str - Stringa JSON da parsare
 * @param {*} [fallback=null] - Valore di fallback se il parse fallisce
 * @returns {*} Oggetto parsato o fallback
 */
function safeJsonParse(str, fallback = null) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return fallback;
    }
}

/**
 * Elimina un messaggio in modo sicuro, loggando eventuali errori.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @param {string} [module='unknown'] - Nome del modulo per logging
 * @returns {Promise<boolean>} True se eliminato, false se fallito
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
 * Modifica il testo di un messaggio in modo sicuro.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @param {string} text - Nuovo testo del messaggio
 * @param {Object} [options={}] - Opzioni (reply_markup, parse_mode, etc.)
 * @param {string} [module='unknown'] - Nome del modulo per logging
 * @returns {Promise<boolean>} True se modificato, false se fallito
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
 * Banna un membro della chat in modo sicuro.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @param {number} userId - ID utente da bannare
 * @param {string} [module='unknown'] - Nome del modulo per logging
 * @returns {Promise<boolean>} True se bannato, false se fallito
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
 * Ottiene le informazioni di un membro della chat in modo sicuro.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @param {number} userId - ID utente da verificare
 * @param {string} [module='unknown'] - Nome del modulo per logging
 * @returns {Promise<Object|null>} Oggetto membro o null se fallito
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
 * Verifica se l'utente corrente è un admin del gruppo.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @param {string} [module='unknown'] - Nome del modulo per logging
 * @returns {Promise<boolean>} True se admin, false altrimenti
 */
async function isAdmin(ctx, module = 'unknown') {
    const member = await safeGetChatMember(ctx, ctx.from.id, module);
    if (!member) return false;
    return ['creator', 'administrator'].includes(member.status);
}

/**
 * Verifica se un callback proviene dal menu settings.
 * Rileva se la tastiera corrente contiene un pulsante "settings_main".
 *
 * @param {import('grammy').Context} ctx - Contesto grammY (callback query)
 * @returns {boolean} True se proviene dal menu settings
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
 * Verifica se un ID utente è un super admin.
 * Legge la lista da SUPER_ADMIN_IDS nell'ambiente.
 *
 * @param {number} userId - ID utente da verificare
 * @returns {boolean} True se super admin
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
