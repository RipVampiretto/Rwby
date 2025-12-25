/**
 * @fileoverview Logica core per il sistema Action Log
 * @module features/action-log/core
 *
 * @description
 * Gestisce l'invio effettivo dei log alle destinazioni configurate.
 * Supporta:
 * - Canali di log dedicati
 * - Topic nei gruppi staff (per gruppi con thread)
 * - Inoltro messaggi originali
 * - Formattazione ricca con emoji e link
 *
 * @requires ./utils - Mappe moduli ed emoji
 * @requires ../../i18n - Per traduzioni
 */

const logger = require('../../middlewares/logger');
const { MODULE_MAP, EMOJI_MAP } = require('./utils');
const i18n = require('../../i18n');

/**
 * Riferimento al database
 * @type {Object|null}
 * @private
 */
let db = null;

/**
 * Istanza del bot grammY
 * @type {import('grammy').Bot|null}
 * @private
 */
let _botInstance = null;

/**
 * Inizializza il modulo core.
 *
 * @param {import('grammy').Bot} bot - Istanza del bot
 * @param {Object} database - Istanza del database
 */
function init(bot, database) {
    _botInstance = bot;
    db = database;
}

/**
 * Invia un evento di log al canale configurato.
 *
 * @param {Object} params - Parametri dell'evento
 * @param {number} params.guildId - ID del gruppo
 * @param {string} [params.guildName] - Nome del gruppo
 * @param {string} params.eventType - Tipo evento (es. 'lang_delete', 'media_ban')
 * @param {Object} params.targetUser - Utente target dell'azione
 * @param {number} params.targetUser.id - ID utente
 * @param {string} params.targetUser.first_name - Nome utente
 * @param {string} [params.targetUser.username] - Username
 * @param {string} [params.executorModule] - Nome del modulo che ha eseguito l'azione
 * @param {string} [params.reason] - Motivo dell'azione
 * @param {string} [params.messageLink] - Link al messaggio originale
 * @param {string[]} [params.customTags] - Tag personalizzati (default: generati automaticamente)
 * @param {number} [params.messageIdToForward] - ID messaggio da inoltrare
 * @param {number} [params.chatIdToForwardFrom] - ID chat da cui inoltrare
 * @returns {Promise<void>}
 */
async function logEvent(params) {
    if (!db || !_botInstance) return;

    const { guildId, guildName, eventType, targetUser, executorModule, reason, messageLink } = params;
    logger.info(`[action-log] Processing event ${eventType} for guild ${guildId}`);

    const config = await db.getGuildConfig(guildId);
    if (!config) return;

    // Ottiene la lingua del gruppo per le traduzioni
    const lang = await i18n.getLanguage(guildId);
    const t = (key, p) => i18n.t(lang, key, p);

    // Parse degli eventi abilitati
    let logEvents = {};
    if (config.log_events) {
        try {
            const parsed = typeof config.log_events === 'string' ? JSON.parse(config.log_events) : config.log_events;
            if (Array.isArray(parsed)) {
                // Conversione formato legacy (array -> oggetto)
                parsed.forEach(t => {
                    logEvents[`${t}_delete`] = true;
                    logEvents[`${t}_ban`] = true;
                    logEvents[`${t}_scam`] = true;
                });
            } else {
                logEvents = parsed;
            }
        } catch (e) { }
    }

    // Verifica se questo tipo di evento è abilitato
    if (!logEvents[eventType]) {
        logger.info(
            `[action-log] Event ${eventType} blocked by config. Config keys: ${Object.keys(logEvents).join(', ')}`
        );
        return;
    }

    const moduleName = executorModule || MODULE_MAP[eventType] || 'System';
    const emoji = EMOJI_MAP[eventType] || 'ℹ️';

    // Determina il tipo di azione per i tag
    let actionType = 'ACTION';
    if (eventType.endsWith('_ban')) actionType = 'BAN';
    else if (eventType.endsWith('_delete')) actionType = 'DELETE';
    else if (eventType.endsWith('_dismiss')) actionType = 'DISMISS';
    const moduleTag = eventType.split('_')[0].toUpperCase();

    // Ottieni info del bot
    let botInfo = { first_name: 'Bot', username: 'bot', id: 0 };
    try {
        botInfo = await _botInstance.api.getMe();
    } catch (e) { }

    // Costruisce i link HTML
    const botLink = botInfo.username
        ? `<a href="https://t.me/${botInfo.username}">${botInfo.first_name}</a>`
        : botInfo.first_name;
    const userLink = targetUser?.username
        ? `<a href="https://t.me/${targetUser.username}">${targetUser.first_name}</a>`
        : `<a href="tg://user?id=${targetUser?.id}">${targetUser?.first_name || 'Unknown'}</a>`;

    // Costruisce il messaggio di log
    const tags = params.customTags || [`#${moduleTag}`, `#${actionType}`];
    let text = `${emoji} ${tags.join(' ')}\n`;
    text += `• ${t('logger.log.by')}: ${botLink} [${botInfo.id}]\n`;
    text += `• ${t('logger.log.to')}: ${userLink} [${targetUser?.id}]\n`;
    text += `• ${t('logger.log.group')}: ${guildName || config.guild_name || guildId} [${guildId}]\n`;
    if (reason) {
        text += `• ${t('logger.log.reason')}: ${reason}\n`;
    }
    if (messageLink) {
        text += `• 👀 ${t('logger.log.go_to_message')} (${messageLink})\n`;
    }
    text += `#id${targetUser?.id}`;

    // Invia al canale di log configurato
    if (config.log_channel_id) {
        try {
            let targetChatId = config.log_channel_id;
            let messageThreadId = null;

            // Verifica se usare topic nel gruppo staff
            if (config.staff_group_id && config.staff_topics) {
                try {
                    const topics =
                        typeof config.staff_topics === 'string' ? JSON.parse(config.staff_topics) : config.staff_topics;
                    if (topics.logs) {
                        targetChatId = config.staff_group_id;
                        messageThreadId = topics.logs;
                    }
                } catch (e) { }
            }

            // Inoltra il messaggio originale se richiesto
            if (params.messageIdToForward && params.chatIdToForwardFrom) {
                try {
                    await _botInstance.api.forwardMessage(
                        targetChatId,
                        params.chatIdToForwardFrom,
                        params.messageIdToForward,
                        {
                            message_thread_id: messageThreadId
                        }
                    );
                } catch (e) {
                    logger.debug(`[action-log] Failed to forward message: ${e.message}`);
                }
            }

            await _botInstance.api.sendMessage(targetChatId, text, {
                message_thread_id: messageThreadId,
                disable_web_page_preview: true,
                parse_mode: 'HTML'
            });
        } catch (e) {
            logger.error(`[action-log] Failed to send local log: ${e.message}`);
        }
    }
}

module.exports = {
    init,
    logEvent
};
