/**
 * @fileoverview Modulo Welcome System - Gestione benvenuto e captcha
 * @module features/welcome-system
 *
 * @description
 * Sistema completo per gestire l'ingresso di nuovi membri nei gruppi Telegram.
 * Include captcha interattivi, messaggi di benvenuto personalizzabili,
 * accettazione regolamento e auto-eliminazione messaggi.
 *
 * Funzionalità principali:
 * - Captcha multi-modalità (button, math, emoji, color, reverse, logic, char)
 * - Messaggi di benvenuto con wildcards ({mention}, {user}, {group_name}, etc.)
 * - Pulsanti personalizzabili nei messaggi
 * - Timeout configurabile con kick automatico
 * - Integrazione con sistema regolamento
 * - Logging eventi nel canale di log
 *
 * @requires grammy
 * @requires ./core - Logica principale captcha e benvenuto
 * @requires ./commands - Handler callback UI
 * @requires ./wizard - Wizard configurazione interattiva
 * @requires ./ui - Interfaccia di configurazione
 */

const { handleNewMember, handleCaptchaCallback, handleMemberLeft, checkExpiredCaptchas, handleLeftMessage } = require('./core');
const { handleCallback } = require('./commands');
const { handleMessage } = require('./wizard');
const ui = require('./ui');
const logger = require('../../middlewares/logger');
const { chatMemberFilter } = require('@grammyjs/chat-members');

/**
 * Riferimento al database, inizializzato tramite init()
 * @type {Object|null}
 * @private
 */
let db = null;

/**
 * Inizializza il modulo con il database.
 *
 * @param {Object} database - Istanza del database PostgreSQL
 * @returns {void}
 */
function init(database) {
    db = database;
    logger.info(`[Welcome] Module initialized`);
}

/**
 * Registra tutti gli handler del modulo sul bot.
 *
 * Handler registrati:
 * - chat_member: Gestisce join/leave dei membri con chatMemberFilter
 * - message:new_chat_members: Backup per join (alcuni client)
 * - callback_query:data: Gestisce callback captcha (wc:) e UI (wc_)
 * - message:text: Listener per wizard configurazione
 *
 * @param {import('grammy').Bot} bot - Istanza del bot grammY
 * @returns {void}
 */
function register(bot) {
    logger.debug(`[Welcome] Registering event handlers with chatMemberFilter...`);

    // Filtra solo gruppi e supergruppi
    const groups = bot.chatType(['group', 'supergroup']);

    // Utente entra nel gruppo (out -> in: left/kicked/restricted_out -> member/admin/restricted_in)
    groups.filter(chatMemberFilter('out', 'in'), async (ctx, next) => {
        const { new_chat_member: { user } } = ctx.chatMember;
        logger.info(`[Welcome] chat_member JOIN: user=${user.id} (${user.first_name}) in chat ${ctx.chat.id}`, ctx);
        await handleNewMember(ctx);
        return next();
    });

    // Utente esce dal gruppo (in -> out: member/admin/restricted_in -> left/kicked)
    groups.filter(chatMemberFilter('in', 'out'), async (ctx, next) => {
        const { old_chat_member: { user } } = ctx.chatMember;
        logger.info(`[Welcome] chat_member LEAVE: user=${user.id} (${user.first_name}) from chat ${ctx.chat.id}`, ctx);
        await handleMemberLeft(ctx);
        return next();
    });

    // NOTA: message:left_chat_member rimosso perché chatMemberFilter('in', 'out')
    // gestisce correttamente le uscite. La logica è in handleMemberLeft (core.js)

    // RE-ENABLED: We need message:new_chat_members to capture the service_message_id
    // for deletion purposes. The logic in core.js handles duplicates safely.
    bot.on('message:new_chat_members', async (ctx, next) => {
        logger.debug(`[Welcome] message:new_chat_members event received`, ctx);
        await handleNewMember(ctx);
        return next();
    });

    // Callback
    bot.on('message:left_chat_member', async (ctx, next) => {
        logger.debug(`[Welcome] message:left_chat_member event received`, ctx);
        await handleLeftMessage(ctx);
        return next();
    });

    // Callback
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (data.startsWith('wc:')) {
            logger.debug(`[Welcome] Routing to captcha callback handler: ${data}`, ctx);
            return handleCaptchaCallback(ctx);
        }

        if (data.startsWith('wc_')) {
            logger.debug(`[Welcome] Routing to UI callback handler: ${data}`, ctx);
            return handleCallback(ctx);
        }

        return next();
    });

    // Wizard Message Listener
    bot.on('message:text', async (ctx, next) => {
        const handled = await handleMessage(ctx);
        if (handled) return;
        return next();
    });

    // Start Expiration Loop (every 30s)
    setInterval(async () => {
        try {
            await checkExpiredCaptchas(bot);
        } catch (e) {
            logger.error(`[Welcome] Expiration check error: ${e.message}`);
        }

        // Cleanup old verified users (older than 5 mins - no longer needed for join-run detection)
        try {
            const { cleanupOldVerifiedUsers } = require('./db-store');
            const removed = await cleanupOldVerifiedUsers(5);
            if (removed > 0) {
                logger.debug(`[Welcome] Cleaned up ${removed} old verified user records.`);
            }
        } catch (e) {
            logger.debug(`[Welcome] Cleanup error: ${e.message}`);
        }
    }, 30000);
}

module.exports = {
    init,
    register,
    ui // Esporta UI per uso dal menu settings
};
