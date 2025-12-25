/**
 * @fileoverview Azioni di moderazione per il modulo Media Filter
 * @module features/media-filter/actions
 *
 * @description
 * Gestisce l'esecuzione delle azioni di moderazione quando viene rilevato
 * contenuto NSFW. Supporta sia media singoli che album.
 *
 * Azioni disponibili:
 * - **delete**: Elimina il messaggio, invia al log channel e Parliament, avvisa l'utente
 * - **report_only**: Inoltra alla coda di revisione dello staff senza eliminare
 *
 * Funzionalità aggiuntive:
 * - Salvataggio media nel canale di log prima dell'eliminazione
 * - Inoltro a Parliament con opzione di Global Ban
 * - Messaggi di warning auto-eliminanti
 * - Logging eventi configurabile
 *
 * @requires ../action-log - Per il logging delle azioni
 * @requires ../super-admin - Per l'inoltro a Parliament
 * @requires ../staff-coordination - Per la coda di revisione
 */

const actionLog = require('../action-log');
const superAdmin = require('../super-admin');
const staffCoordination = require('../staff-coordination');
const i18n = require('../../i18n');
const { safeDelete } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');

/**
 * Invia un media a un canale usando il file_id (senza forward).
 * Gestisce foto, video, animazioni, sticker e documenti.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY della richiesta
 * @param {string} channelId - ID del canale di destinazione
 * @param {string|null} [caption=null] - Caption opzionale in HTML
 * @returns {Promise<void>}
 * @private
 */
async function sendMediaToChannel(ctx, channelId, caption = null) {
    const msg = ctx.message;
    const options = caption ? { caption, parse_mode: 'HTML' } : {};

    try {
        if (msg.photo) {
            const photo = msg.photo[msg.photo.length - 1];
            await ctx.api.sendPhoto(channelId, photo.file_id, options);
        } else if (msg.video) {
            await ctx.api.sendVideo(channelId, msg.video.file_id, options);
        } else if (msg.animation) {
            await ctx.api.sendAnimation(channelId, msg.animation.file_id, options);
        } else if (msg.sticker) {
            await ctx.api.sendSticker(channelId, msg.sticker.file_id);
        } else if (msg.document) {
            await ctx.api.sendDocument(channelId, msg.document.file_id, options);
        }
    } catch (e) {
        logger.debug(`[media-filter] sendMediaToChannel error: ${e.message}`);
    }
}

/**
 * Esegue l'azione di moderazione per un singolo media NSFW.
 *
 * Flusso per action='delete':
 * 1. Invia il media al Log Channel (se configurato)
 * 2. Inoltra a Parliament con opzione Global Ban
 * 3. Elimina il messaggio originale
 * 4. Invia warning all'utente (auto-delete dopo 60s)
 * 5. Logga l'evento se abilitato
 *
 * Flusso per action='report_only':
 * 1. Inoltra alla coda di revisione dello staff
 *
 * @param {import('grammy').Context} ctx - Contesto grammY del messaggio con il media
 * @param {string} action - Azione da eseguire: 'delete' | 'report_only'
 * @param {string} reason - Motivo della violazione (es. "Real Nudity (95%)")
 * @param {string} type - Tipo di media: 'photo' | 'video' | 'gif' | 'sticker'
 * @returns {Promise<void>}
 */
async function executeAction(ctx, action, reason, type) {
    const user = ctx.from;

    // Recupera configurazione per log events
    const db = require('../../database');
    const config = await db.getGuildConfig(ctx.chat.id);
    let logEvents = {};
    if (config.log_events) {
        if (typeof config.log_events === 'string') {
            try {
                logEvents = JSON.parse(config.log_events);
            } catch (e) {}
        } else if (typeof config.log_events === 'object') {
            logEvents = config.log_events;
        }
    }

    // Semplifica il motivo per i log (rimuove dettagli tecnici come "Frame @...")
    let simpleReason = reason;
    try {
        const match = reason.match(/(?:Frame @[\d.]+s: )?([^(\n]+)/);
        if (match && match[1]) {
            simpleReason = match[1].trim();
        }
    } catch (e) {
        simpleReason = reason;
    }

    /** @type {Object} Parametri per il log dell'azione */
    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'media_delete',
        targetUser: user,
        reason: `Categoria vietata: ${simpleReason}`,
        isGlobal: false
    };

    if (action === 'delete') {
        // Invia media originale al Log Channel PRIMA di eliminarlo
        if (config.log_channel_id) {
            await sendMediaToChannel(ctx, config.log_channel_id);
        }

        // Inoltra a Parliament con opzione Global Ban
        if (superAdmin.forwardMediaToParliament) {
            const parlLang = await i18n.getLanguage(ctx.chat.id);
            const t = key => i18n.t(parlLang, key);
            const caption =
                `🖼️ <b>NSFW CONTENT</b>\n\n` +
                `${t('common.logs.group')}: ${ctx.chat.title}\n` +
                `${t('common.logs.user')}: <a href="tg://user?id=${user.id}">${user.first_name}</a> [<code>${user.id}</code>]\n` +
                `📝 Category: ${reason}\n` +
                `📁 Type: ${type}`;

            await superAdmin.forwardMediaToParliament('image_spam', ctx, caption, [
                [
                    { text: t('common.logs.global_ban_user'), callback_data: `gban:${user.id}` },
                    { text: '✅ Ignore', callback_data: 'parl_dismiss' }
                ]
            ]);
        }

        // Elimina il messaggio
        await safeDelete(ctx, 'media-monitor');

        // Invia warning all'utente (auto-delete dopo 1 minuto)
        try {
            const lang = await i18n.getLanguage(ctx.chat.id);
            const userName = user.username
                ? `@${user.username}`
                : `<a href="tg://user?id=${user.id}">${user.first_name}</a>`;
            const warningMsg = i18n.t(lang, 'media.warning', { user: userName });

            const warning = await ctx.reply(warningMsg, { parse_mode: 'HTML' });
            setTimeout(async () => {
                try {
                    await ctx.api.deleteMessage(ctx.chat.id, warning.message_id);
                } catch (e) {}
            }, 60000);
        } catch (e) {}

        // Logga solo se abilitato
        if (logEvents['media_delete'] && actionLog.getLogEvent()) {
            actionLog.getLogEvent()(logParams);
        }
    } else if (action === 'report_only') {
        // Inoltra al gruppo staff per revisione
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Media-AI',
            user: user,
            reason: reason,
            messageId: ctx.message.message_id,
            content: `[Media ${type}]`
        });
    }
}

/**
 * @typedef {Object} AlbumViolation
 * @property {import('grammy').Context} ctx - Contesto del messaggio violante
 * @property {string} reason - Motivo della violazione
 * @property {string} type - Tipo di media
 */

/**
 * Esegue un'azione batched per le violazioni di un album.
 * Ottimizza il processo eliminando tutti i media insieme e inviando
 * un singolo warning invece di uno per ogni violazione.
 *
 * @param {AlbumViolation[]} violations - Array di violazioni trovate nell'album
 * @param {Object} config - Configurazione del gruppo
 * @param {string} config.media_action - Azione: 'delete' | 'report_only'
 * @param {string} [config.log_channel_id] - ID del canale di log
 * @param {Object|string} [config.log_events] - Eventi da loggare
 * @returns {Promise<void>}
 */
async function executeAlbumAction(violations, config) {
    if (!violations || violations.length === 0) return;

    const firstCtx = violations[0].ctx;
    const user = firstCtx.from;
    const action = config.media_action || 'delete';

    // Parse log events dalla config
    const db = require('../../database');
    let logEvents = {};
    if (config.log_events) {
        if (typeof config.log_events === 'string') {
            try {
                logEvents = JSON.parse(config.log_events);
            } catch (e) {}
        } else if (typeof config.log_events === 'object') {
            logEvents = config.log_events;
        }
    }

    // Aggrega i motivi (categorie uniche)
    const categories = [
        ...new Set(
            violations.map(v => {
                const match = v.reason?.match(/(?:Frame @[\d.]+s: )?([^(\n]+)/);
                return match ? match[1].trim() : v.reason;
            })
        )
    ];
    const aggregatedReason = categories.join(', ');

    const logParams = {
        guildId: firstCtx.chat.id,
        eventType: 'media_delete',
        targetUser: user,
        reason: `Album (${violations.length} media): ${aggregatedReason}`,
        isGlobal: false
    };

    if (action === 'delete') {
        // Prepara media group da tutte le violazioni
        const mediaItems = violations
            .map((v, idx) => {
                const msg = v.ctx.message;
                let item = null;
                if (msg.photo) {
                    const photo = msg.photo[msg.photo.length - 1];
                    item = { type: 'photo', media: photo.file_id };
                } else if (msg.video) {
                    item = { type: 'video', media: msg.video.file_id };
                } else if (msg.animation) {
                    // Le animazioni non possono stare in un media group, trattale come document
                    item = { type: 'document', media: msg.animation.file_id };
                } else if (msg.document) {
                    item = { type: 'document', media: msg.document.file_id };
                }
                // Aggiungi caption solo al primo elemento
                if (item && idx === 0) {
                    item.caption = `🚫 Album eliminato: ${aggregatedReason}`;
                }
                return item;
            })
            .filter(Boolean);

        // Invia album al Log Channel
        if (config.log_channel_id && mediaItems.length > 0) {
            try {
                if (mediaItems.length === 1) {
                    await sendMediaToChannel(firstCtx, config.log_channel_id);
                } else {
                    await firstCtx.api.sendMediaGroup(config.log_channel_id, mediaItems);
                }
            } catch (e) {
                logger.debug(`[media-filter] sendMediaGroup to log error: ${e.message}`);
            }
        }

        // Invia album a Parliament con summary
        if (superAdmin.forwardAlbumToParliament) {
            await superAdmin.forwardAlbumToParliament('image_spam', violations, {
                groupTitle: firstCtx.chat.title,
                user: user,
                reason: aggregatedReason,
                count: violations.length
            });
        } else if (superAdmin.forwardMediaToParliament) {
            // Fallback a singolo media
            const parlLang = await i18n.getLanguage(firstCtx.chat.id);
            const t = key => i18n.t(parlLang, key);
            const caption =
                `🖼️ <b>NSFW ALBUM</b>\n\n` +
                `${t('common.logs.group')}: ${firstCtx.chat.title}\n` +
                `${t('common.logs.user')}: <a href="tg://user?id=${user.id}">${user.first_name}</a> [<code>${user.id}</code>]\n` +
                `📁 Deleted media: ${violations.length}\n` +
                `📝 Categories: ${aggregatedReason}`;

            await superAdmin.forwardMediaToParliament('image_spam', firstCtx, caption, [
                [
                    { text: t('common.logs.global_ban_user'), callback_data: `gban:${user.id}` },
                    { text: '✅ Ignore', callback_data: 'parl_dismiss' }
                ]
            ]);
        }

        // Elimina tutti i messaggi violanti
        for (const v of violations) {
            await safeDelete(v.ctx, 'media-monitor-album');
        }

        // Invia un singolo warning all'utente (auto-delete dopo 1 minuto)
        try {
            const lang = await i18n.getLanguage(firstCtx.chat.id);
            const userName = user.username
                ? `@${user.username}`
                : `<a href="tg://user?id=${user.id}">${user.first_name}</a>`;
            // Usa versione plurale per album
            const warningKey = violations.length > 1 ? 'media.warning_album' : 'media.warning';
            let warningMsg = i18n.t(lang, warningKey, { user: userName, count: violations.length });
            // Fallback a singolare se la chiave plurale non esiste
            if (warningMsg === warningKey) {
                warningMsg = i18n.t(lang, 'media.warning', { user: userName });
            }

            const warning = await firstCtx.reply(warningMsg, { parse_mode: 'HTML' });
            setTimeout(async () => {
                try {
                    await firstCtx.api.deleteMessage(firstCtx.chat.id, warning.message_id);
                } catch (e) {}
            }, 60000);
        } catch (e) {}

        // Logga solo se abilitato (singolo log per intero album)
        if (logEvents['media_delete'] && actionLog.getLogEvent()) {
            actionLog.getLogEvent()(logParams);
        }
    } else if (action === 'report_only') {
        // Inoltra al gruppo staff per revisione (singola segnalazione)
        staffCoordination.reviewQueue({
            guildId: firstCtx.chat.id,
            source: 'Media-AI (Album)',
            user: user,
            reason: `Album: ${aggregatedReason}`,
            messageId: firstCtx.message.message_id,
            content: `[Album: ${violations.length} media]`
        });
    }
}

module.exports = {
    executeAction,
    executeAlbumAction
};
