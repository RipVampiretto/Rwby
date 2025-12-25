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

const { handleNewMember, handleCaptchaCallback, handleMemberLeft } = require('./core');
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
}

module.exports = {
    init,
    register,
    ui // Esporta UI per uso dal menu settings
};
