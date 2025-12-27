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

const { handleNewMember, handleCaptchaCallback, handleMemberLeft, checkExpiredCaptchas } = require('./core');
const { handleCallback } = require('./commands');
const { handleMessage } = require('./wizard');
const ui = require('./ui');
const logger = require('../../middlewares/logger');

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
}

/**
 * Registra tutti gli handler del modulo sul bot.
 *
 * Handler registrati:
 * - chat_member: Gestisce join/leave dei membri
 * - message:new_chat_members: Backup per join (alcuni client)
 * - callback_query:data: Gestisce callback captcha (wc:) e UI (wc_)
 * - message:text: Listener per wizard configurazione
 *
 * @param {import('grammy').Bot} bot - Istanza del bot grammY
 * @returns {void}
 */
function register(bot) {
    // Eventi join/leave
    bot.on('chat_member', async (ctx, next) => {
        // Gestisce sia join che leave negli update chat_member
        await handleNewMember(ctx);
        await handleMemberLeft(ctx);
        return next();
    });
    bot.on('message:new_chat_members', handleNewMember);

    // Fallback per left_chat_member (quando chat_member update non è disponibile)
    bot.on('message:left_chat_member', async (ctx, next) => {
        const leftUser = ctx.message.left_chat_member;
        if (!leftUser || leftUser.is_bot) return next();

        logger.debug(`[Welcome] left_chat_member event: user=${leftUser.id} (${leftUser.first_name})`);

        const dbStore = require('./db-store');

        // Check for pending captcha (user left during verification)
        try {
            const pending = await dbStore.getPendingCaptcha(ctx.chat.id, leftUser.id);
            if (pending) {
                // Delete captcha message
                await ctx.api.deleteMessage(ctx.chat.id, pending.message_id).catch(() => { });
                // Delete service message (join)
                if (pending.service_message_id) {
                    await ctx.api.deleteMessage(ctx.chat.id, pending.service_message_id).catch(() => { });
                }
                // Delete the left_chat_member service message itself
                await ctx.deleteMessage().catch(() => { });
                // Remove from DB
                await dbStore.removePendingCaptcha(ctx.chat.id, leftUser.id);
                logger.info(`[Welcome] Cleaned up pending captcha for user ${leftUser.id} who left.`);
                return next();
            }
        } catch (e) {
            logger.debug(`[Welcome] Failed to clean up captcha for leaver: ${e.message}`);
        }

        // Check for recently verified (join & run detection)
        try {
            const recent = await dbStore.getRecentlyVerified(ctx.chat.id, leftUser.id);
            if (recent) {
                const now = new Date();
                const verifiedAt = new Date(recent.verified_at);
                const diffMins = (now - verifiedAt) / 60000;

                if (diffMins < 5) {
                    // User verified less than 5 mins ago and left! (join & run)
                    logger.info(`[Welcome] Join & Run detected: user ${leftUser.id} left ${diffMins.toFixed(1)} mins after verification.`);

                    // Delete Welcome Message
                    if (recent.welcome_message_id) {
                        await ctx.api.deleteMessage(ctx.chat.id, recent.welcome_message_id).catch(() => { });
                    }

                    // Delete Service Message (join)
                    if (recent.service_message_id) {
                        await ctx.api.deleteMessage(ctx.chat.id, recent.service_message_id).catch(() => { });
                    }

                    // Delete the left_chat_member service message itself
                    await ctx.deleteMessage().catch(() => { });
                }

                // Clean up recent record
                await dbStore.removeRecentlyVerified(ctx.chat.id, leftUser.id);
            }
        } catch (e) {
            logger.debug(`[Welcome] Failed to clean up join-run: ${e.message}`);
        }

        return next();
    });


    // Callback
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (data.startsWith('wc:')) {
            return handleCaptchaCallback(ctx);
        }

        if (data.startsWith('wc_')) {
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

    // Start Expiration Loop (every 60s)
    setInterval(async () => {
        checkExpiredCaptchas(bot);

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
    }, 60000);
}

module.exports = {
    init,
    register,
    ui // Esporta UI per uso dal menu settings
};
