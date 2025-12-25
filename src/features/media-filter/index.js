/**
 * @fileoverview Modulo Media Filter - Analisi NSFW di contenuti multimediali
 * @module features/media-filter
 *
 * @description
 * Questo modulo gestisce l'analisi automatica di foto, video, GIF e sticker
 * per rilevare contenuti NSFW (Not Safe For Work). Utilizza un modello Vision LLM
 * locale (LM Studio) per classificare i contenuti in categorie come nudità,
 * contenuti sessuali, gore, scam visivi e altro.
 *
 * Funzionalità principali:
 * - Analisi immagini singole via Vision LLM
 * - Estrazione e analisi frame per video/GIF
 * - Gestione album con batching intelligente
 * - Azioni configurabili (elimina, segnala)
 * - Categorie bloccabili personalizzabili per gruppo
 *
 * @requires grammy
 * @requires fluent-ffmpeg - Per estrazione frame da video
 * @requires ./logic - Logica core di analisi
 * @requires ./commands - Handler comandi e callback
 * @requires ./ui - Interfaccia di configurazione
 */

const commands = require('./commands');
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
 * Include handler per media (foto/video/gif/sticker) e callback UI.
 *
 * @param {import('grammy').Bot} bot - Istanza del bot grammY
 * @returns {void}
 */
function register(bot) {
    commands.registerCommands(bot, db);
    logger.info('[media-filter] Module registered and ready');
}

/**
 * Mostra l'interfaccia di configurazione del modulo.
 * Può essere chiamata dal menu settings o direttamente.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY della richiesta
 * @param {boolean} [isEdit=false] - Se true, modifica il messaggio esistente invece di inviarne uno nuovo
 * @param {boolean} [fromSettings=false] - Se true, mostra il pulsante "Indietro" verso il menu settings
 * @returns {Promise<void>}
 */
function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    init,
    register,
    sendConfigUI
};
