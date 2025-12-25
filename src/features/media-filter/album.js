/**
 * @fileoverview Gestione Album per il modulo Media Filter
 * @module features/media-filter/album
 *
 * @description
 * Gestisce il batching intelligente degli album Telegram. Quando un utente invia
 * più media insieme (album), questo modulo:
 *
 * 1. Avvia l'analisi di ogni media IMMEDIATAMENTE (non-blocking)
 * 2. Memorizza le Promise di analisi in un buffer
 * 3. Aspetta che tutti i media dell'album arrivino (timeout configurabile)
 * 4. Attende il completamento di TUTTE le analisi
 * 5. Esegue un'azione batched su tutte le violazioni trovate
 *
 * Questo approccio ottimizza le prestazioni analizzando in parallelo
 * invece di aspettare ogni media sequenzialmente.
 *
 * @requires ./logic - Per l'analisi dei singoli media
 * @requires ./actions - Per l'esecuzione delle azioni sulle violazioni
 */

const logic = require('./logic');
const actions = require('./actions');
const logger = require('../../middlewares/logger');

/**
 * Buffer per gli album in elaborazione.
 * Mappa media_group_id -> dati dell'album
 *
 * @type {Map<string, AlbumBufferEntry>}
 * @private
 */
const ALBUM_BUFFER = new Map();

/**
 * Timeout in millisecondi per attendere l'arrivo di tutti gli elementi dell'album.
 * Aumentato per gestire la consegna lenta di Telegram.
 *
 * @constant {number}
 * @default 3000
 */
const ALBUM_TIMEOUT = 3000;

/**
 * @typedef {Object} AlbumBufferEntry
 * @property {Promise<AnalysisResult>[]} analysisPromises - Promise delle analisi in corso
 * @property {NodeJS.Timeout|null} timer - Timer per il processing dell'album
 * @property {Object} config - Configurazione del gruppo
 * @property {number} chatId - ID della chat Telegram
 * @property {number} userId - ID dell'utente che ha inviato l'album
 */

/**
 * @typedef {Object} AnalysisResult
 * @property {import('grammy').Context} ctx - Contesto grammY del messaggio
 * @property {Object} result - Risultato dell'analisi
 * @property {boolean} result.isNsfw - Se il contenuto è NSFW
 * @property {string} [result.reason] - Motivo della violazione
 * @property {string} [result.type] - Tipo di media (photo/video/gif)
 */

/**
 * Aggiunge un elemento media al buffer dell'album e avvia l'analisi immediatamente.
 * Se è il primo elemento dell'album, crea una nuova entry nel buffer.
 * Resetta il timer ad ogni nuovo elemento ricevuto.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY con il messaggio media
 * @param {Object} config - Configurazione del gruppo (media_enabled, media_action, etc.)
 * @returns {void}
 */
function bufferAlbumItem(ctx, config) {
    const mediaGroupId = ctx.message.media_group_id;
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id;

    if (!ALBUM_BUFFER.has(mediaGroupId)) {
        ALBUM_BUFFER.set(mediaGroupId, {
            analysisPromises: [],
            timer: null,
            config,
            chatId,
            userId
        });
    }

    const album = ALBUM_BUFFER.get(mediaGroupId);

    // Avvia l'analisi IMMEDIATAMENTE (non-blocking)
    const analysisPromise = analyzeItem(ctx, config);
    album.analysisPromises.push(analysisPromise);

    // Cancella il timer esistente e impostane uno nuovo
    if (album.timer) {
        clearTimeout(album.timer);
    }

    album.timer = setTimeout(async () => {
        await processAlbum(mediaGroupId);
    }, ALBUM_TIMEOUT);

    logger.debug(
        `[media-filter] 📦 Buffered album item ${album.analysisPromises.length} for group ${mediaGroupId} - analysis started`
    );
}

/**
 * Analizza un singolo elemento media dell'album.
 * Wrapper asincrono che cattura eventuali errori e restituisce sempre un risultato valido.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY con il messaggio media
 * @param {Object} config - Configurazione del gruppo
 * @returns {Promise<{ctx: import('grammy').Context, result: {isNsfw: boolean, reason?: string, type?: string}}>}
 * @private
 */
async function analyzeItem(ctx, config) {
    try {
        const result = await logic.analyzeMediaOnly(ctx, config);
        return { ctx, result };
    } catch (err) {
        logger.error(`[media-filter] ❌ Album item analysis error: ${err.message}`);
        return { ctx, result: { isNsfw: false } };
    }
}

/**
 * Processa tutti gli elementi di un album dopo che tutte le analisi sono completate.
 * Raccoglie le violazioni e esegue un'azione batched se ce ne sono.
 *
 * @param {string} mediaGroupId - ID del media_group dell'album
 * @returns {Promise<void>}
 * @private
 */
async function processAlbum(mediaGroupId) {
    const album = ALBUM_BUFFER.get(mediaGroupId);
    if (!album) return;

    ALBUM_BUFFER.delete(mediaGroupId);

    const { analysisPromises, config, chatId, userId } = album;
    logger.info(
        `[media-filter] 📦 Waiting for ${analysisPromises.length} album analyses to complete - Chat: ${chatId}, User: ${userId}`
    );

    // Attendi il completamento di TUTTE le analisi
    const results = await Promise.all(analysisPromises);

    // Raccogli le violazioni
    const violations = [];
    for (const { ctx, result } of results) {
        if (result && result.isNsfw) {
            violations.push({
                ctx,
                reason: result.reason,
                type: result.type
            });
        }
    }

    if (violations.length > 0) {
        logger.warn(`[media-filter] 🚨 Album has ${violations.length}/${results.length} violations`);
        await actions.executeAlbumAction(violations, config);
    } else {
        logger.info(`[media-filter] ✅ Album is SAFE - ${results.length} items checked`);
    }
}

/**
 * Verifica se un messaggio fa parte di un album.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @returns {boolean} True se il messaggio ha un media_group_id
 */
function isAlbumItem(ctx) {
    return !!ctx.message?.media_group_id;
}

module.exports = {
    bufferAlbumItem,
    processAlbum,
    isAlbumItem,
    ALBUM_BUFFER
};
