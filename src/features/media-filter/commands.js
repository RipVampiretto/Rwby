/**
 * @fileoverview Handler comandi e callback per il modulo Media Filter
 * @module features/media-filter/commands
 *
 * @description
 * Gestisce tutti gli handler per:
 * - Ricezione media (foto, video, GIF, sticker, documenti)
 * - Callback delle interfacce UI (toggle, azioni, categorie)
 *
 * Flusso di elaborazione media:
 * 1. Verifica che sia un gruppo (skip chat private)
 * 2. Verifica che l'utente non sia admin
 * 3. Verifica che il modulo sia abilitato
 * 4. Verifica che il tipo di media sia abilitato
 * 5. Se album → buffer per elaborazione batch
 * 6. Se singolo → elaborazione immediata
 *
 * @requires ./logic - Per l'elaborazione media
 * @requires ./ui - Per le interfacce di configurazione
 * @requires ./album - Per la gestione album
 */

const logic = require('./logic');
const ui = require('./ui');
const album = require('./album');
const { isAdmin, isFromSettingsMenu } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');

/**
 * Registra tutti gli handler del modulo sul bot grammY.
 *
 * @param {import('grammy').Bot} bot - Istanza del bot grammY
 * @param {Object} db - Istanza del database PostgreSQL
 * @returns {void}
 */
function registerCommands(bot, db) {
    // Handler: foto, video, animazioni, sticker
    bot.on(
        ['message:photo', 'message:video', 'message:animation', 'message:document', 'message:sticker'],
        async (ctx, next) => {
            const chatId = ctx.chat.id;
            const userId = ctx.from?.id;
            const msgId = ctx.message?.message_id;

            logger.debug(`[media-filter] 📥 Media received - Chat: ${chatId}, User: ${userId}, MsgId: ${msgId}`);

            // Skip chat private
            if (ctx.chat.type === 'private') {
                logger.debug(`[media-filter] ⏭️ Skipping: private chat`);
                return next();
            }

            // Skip admin
            if (await isAdmin(ctx, 'nsfw-monitor')) {
                logger.debug(`[media-filter] ⏭️ Skipping: user ${userId} is admin`);
                return next();
            }

            // Verifica configurazione
            const config = await db.getGuildConfig(ctx.chat.id);
            if (!config.media_enabled) {
                logger.debug(`[media-filter] ⏭️ Skipping: NSFW monitor disabled for chat ${chatId}`);
                return next();
            }

            // Determina tipo di media
            const isVideo =
                ctx.message.video || (ctx.message.document && ctx.message.document.mime_type?.startsWith('video'));
            const isGif =
                ctx.message.animation || (ctx.message.document && ctx.message.document.mime_type === 'image/gif');
            const isPhoto = ctx.message.photo;
            const isSticker = ctx.message.sticker;

            const mediaType = isVideo ? 'VIDEO' : isGif ? 'GIF' : isPhoto ? 'PHOTO' : isSticker ? 'STICKER' : 'UNKNOWN';
            logger.info(`[media-filter] 🎬 Media type detected: ${mediaType} - Chat: ${chatId}, User: ${userId}`);

            // Skip sticker animati (sono file Lottie, non analizzabili)
            if (isSticker && ctx.message.sticker.is_animated) {
                logger.debug(`[media-filter] ⏭️ Skipping: animated sticker (not analyzable)`);
                return next();
            }

            // Verifica se il tipo di media è abilitato per l'analisi
            if (isVideo && !config.media_check_videos) {
                logger.debug(`[media-filter] ⏭️ Skipping: video check disabled`);
                return next();
            }
            if (isGif && !config.media_check_gifs) {
                logger.debug(`[media-filter] ⏭️ Skipping: GIF check disabled`);
                return next();
            }
            if (isPhoto && !config.media_check_photos) {
                logger.debug(`[media-filter] ⏭️ Skipping: photo check disabled`);
                return next();
            }
            if (isSticker && !config.media_check_stickers) {
                logger.debug(`[media-filter] ⏭️ Skipping: sticker check disabled`);
                return next();
            }

            logger.info(
                `[media-filter] ✅ Proceeding with analysis for ${mediaType} - Chat: ${chatId}, User: ${userId}`
            );

            // Verifica se fa parte di un album
            if (album.isAlbumItem(ctx)) {
                // Buffer elementi album per elaborazione batch
                album.bufferAlbumItem(ctx, config);
                logger.debug(`[media-filter] 📦 Media is part of album ${ctx.message.media_group_id}`);
            } else {
                // Media singolo - elabora normalmente (non-blocking)
                logic
                    .processMedia(ctx, config)
                    .catch(err => logger.error(`[media-filter] ❌ Process error: ${err.message}\n${err.stack}`));
            }

            await next();
        }
    );

    // Handler callback UI
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith('nsf_')) return next();

        const config = await db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

        // Chiudi menu
        if (data === 'nsf_close') return ctx.deleteMessage();

        // No-op per pulsanti non cliccabili (categorie sempre bloccate)
        if (data === 'nsf_noop') {
            const i18n = require('../../i18n');
            return ctx.answerCallbackQuery(i18n.t(ctx.lang || 'en', 'nsfw.categories_ui.noop'));
        }

        // Sottomenu categorie
        if (data === 'nsf_categories') {
            await ui.sendCategoriesUI(ctx, db, fromSettings);
            return;
        }

        // Torna dal sottomenu categorie
        if (data === 'nsf_back' || data === 'nsf_back_settings') {
            await ui.sendConfigUI(ctx, db, true, data === 'nsf_back_settings');
            return;
        }

        // Toggle singola categoria
        if (data.startsWith('nsf_cat_')) {
            const categoryId = data.replace('nsf_cat_', '');

            // Recupera categorie bloccate correnti
            let blockedCategories = config.media_blocked_categories;
            if (!blockedCategories || !Array.isArray(blockedCategories)) {
                try {
                    blockedCategories =
                        typeof blockedCategories === 'string'
                            ? JSON.parse(blockedCategories)
                            : logic.getDefaultBlockedCategories();
                } catch (e) {
                    blockedCategories = logic.getDefaultBlockedCategories();
                }
            }

            // Toggle la categoria
            const index = blockedCategories.indexOf(categoryId);
            if (index === -1) {
                blockedCategories.push(categoryId);
            } else {
                blockedCategories.splice(index, 1);
            }

            // Salva
            await db.updateGuildConfig(ctx.chat.id, { media_blocked_categories: blockedCategories });

            // Aggiorna UI categorie
            await ui.sendCategoriesUI(ctx, db, fromSettings);
            return;
        }

        // Toggle abilitazione modulo
        if (data === 'nsf_toggle') {
            await db.updateGuildConfig(ctx.chat.id, { media_enabled: config.media_enabled ? 0 : 1 });
        }
        // Test connessione LM Studio
        else if (data === 'nsf_test') {
            await logic.testConnection(ctx);
            return;
        }
        // Cicla azione (delete -> report_only -> delete)
        else if (data === 'nsf_act') {
            const acts = ['delete', 'report_only'];
            let cur = config.media_action || 'delete';
            if (!acts.includes(cur)) cur = 'delete';
            const nextAct = acts[(acts.indexOf(cur) + 1) % acts.length];
            await db.updateGuildConfig(ctx.chat.id, { media_action: nextAct });
        }
        // Toggle tipo media (photo, video, gif, sticker)
        else if (data.startsWith('nsf_tog_')) {
            const type = data.split('_')[2];
            const key = `media_check_${type}s`;
            if (config[key] !== undefined) {
                await db.updateGuildConfig(ctx.chat.id, { [key]: config[key] ? 0 : 1 });
            }
        }
        // Toggle log eventi
        else if (data.startsWith('nsf_log_')) {
            const logKey = 'media_delete';

            // Recupera log events correnti
            let logEvents = {};
            if (config.log_events) {
                if (typeof config.log_events === 'string') {
                    try {
                        logEvents = JSON.parse(config.log_events);
                    } catch (e) { }
                } else if (typeof config.log_events === 'object') {
                    logEvents = config.log_events;
                }
            }

            // Toggle
            logEvents[logKey] = !logEvents[logKey];
            await db.updateGuildConfig(ctx.chat.id, { log_events: logEvents });
        }

        // Aggiorna UI principale
        await ui.sendConfigUI(ctx, db, true, fromSettings);
    });
}

module.exports = {
    registerCommands
};
