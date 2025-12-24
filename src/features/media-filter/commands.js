const logic = require('./logic');
const ui = require('./ui');
const album = require('./album');
const { isAdmin, isFromSettingsMenu } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');

function registerCommands(bot, db) {
    // Handler: photos, videos, animations, stickers
    bot.on(
        ['message:photo', 'message:video', 'message:animation', 'message:document', 'message:sticker'],
        async (ctx, next) => {
            const chatId = ctx.chat.id;
            const userId = ctx.from?.id;
            const msgId = ctx.message?.message_id;

            logger.debug(`[media-filter] 📥 Media received - Chat: ${chatId}, User: ${userId}, MsgId: ${msgId}`);

            if (ctx.chat.type === 'private') {
                logger.debug(`[media-filter] ⏭️ Skipping: private chat`);
                return next();
            }

            // Skip admins
            if (await isAdmin(ctx, 'nsfw-monitor')) {
                logger.debug(`[media-filter] ⏭️ Skipping: user ${userId} is admin`);
                return next();
            }

            // Config check
            const config = await db.getGuildConfig(ctx.chat.id);
            if (!config.media_enabled) {
                logger.debug(`[media-filter] ⏭️ Skipping: NSFW monitor disabled for chat ${chatId}`);
                return next();
            }

            // Tier bypass (-1 = OFF, no bypass)
            const tierBypass = config.media_tier_bypass ?? 2;
            if (tierBypass !== -1 && ctx.userTier !== undefined && ctx.userTier >= tierBypass) {
                logger.debug(
                    `[media-filter] ⏭️ Skipping: user ${userId} has tier ${ctx.userTier} (bypass >= ${tierBypass})`
                );
                return next();
            }

            // Check types enabled
            const isVideo =
                ctx.message.video || (ctx.message.document && ctx.message.document.mime_type?.startsWith('video'));
            const isGif =
                ctx.message.animation || (ctx.message.document && ctx.message.document.mime_type === 'image/gif');
            const isPhoto = ctx.message.photo;
            const isSticker = ctx.message.sticker;

            const mediaType = isVideo ? 'VIDEO' : isGif ? 'GIF' : isPhoto ? 'PHOTO' : isSticker ? 'STICKER' : 'UNKNOWN';
            logger.info(`[media-filter] 🎬 Media type detected: ${mediaType} - Chat: ${chatId}, User: ${userId}`);

            // Skip animated stickers (they're Lottie files, not images)
            if (isSticker && ctx.message.sticker.is_animated) {
                logger.debug(`[media-filter] ⏭️ Skipping: animated sticker (not analyzable)`);
                return next();
            }

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
            // Stickers have their own check
            if (isSticker && !config.media_check_stickers) {
                logger.debug(`[media-filter] ⏭️ Skipping: sticker check disabled`);
                return next();
            }

            logger.info(
                `[media-filter] ✅ Proceeding with analysis for ${mediaType} - Chat: ${chatId}, User: ${userId}`
            );

            // Check if this is part of an album
            if (album.isAlbumItem(ctx)) {
                // Buffer album items for batch processing
                album.bufferAlbumItem(ctx, config);
                logger.debug(`[media-filter] 📦 Media is part of album ${ctx.message.media_group_id}`);
            } else {
                // Single media - process normally
                logic
                    .processMedia(ctx, config)
                    .catch(err => logger.error(`[media-filter] ❌ Process error: ${err.message}\n${err.stack}`));
            }

            await next();
        }
    );

    // UI Handlers
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith('nsf_')) return next();

        const config = await db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === 'nsf_close') return ctx.deleteMessage();

        // No-op for non-clickable buttons
        if (data === 'nsf_noop') {
            const i18n = require('../../i18n');
            return ctx.answerCallbackQuery(i18n.t(ctx.lang || 'en', 'nsfw.categories_ui.noop'));
        }

        // Categories submenu
        if (data === 'nsf_categories') {
            await ui.sendCategoriesUI(ctx, db, fromSettings);
            return;
        }

        // Back from categories
        if (data === 'nsf_back' || data === 'nsf_back_settings') {
            await ui.sendConfigUI(ctx, db, true, data === 'nsf_back_settings');
            return;
        }

        // Toggle category
        if (data.startsWith('nsf_cat_')) {
            const categoryId = data.replace('nsf_cat_', '');

            // Get current blocked categories
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

            // Toggle the category
            const index = blockedCategories.indexOf(categoryId);
            if (index === -1) {
                blockedCategories.push(categoryId);
            } else {
                blockedCategories.splice(index, 1);
            }

            // Save
            await db.updateGuildConfig(ctx.chat.id, { media_blocked_categories: blockedCategories });

            // Refresh categories UI
            await ui.sendCategoriesUI(ctx, db, fromSettings);
            return;
        }

        if (data === 'nsf_toggle') {
            await db.updateGuildConfig(ctx.chat.id, { media_enabled: config.media_enabled ? 0 : 1 });
        } else if (data === 'nsf_test') {
            await logic.testConnection(ctx);
            return;
        } else if (data === 'nsf_act') {
            // Only delete or report - no ban
            const acts = ['delete', 'report_only'];
            let cur = config.media_action || 'delete';
            if (!acts.includes(cur)) cur = 'delete';
            const nextAct = acts[(acts.indexOf(cur) + 1) % acts.length];
            await db.updateGuildConfig(ctx.chat.id, { media_action: nextAct });
        } else if (data === 'nsf_thr') {
            let thr = config.media_threshold || 0.7;
            thr = thr >= 0.9 ? 0.5 : thr + 0.1;
            await db.updateGuildConfig(ctx.chat.id, { media_threshold: parseFloat(thr.toFixed(1)) });
        } else if (data.startsWith('nsf_tog_')) {
            const type = data.split('_')[2]; // photo, video, gif, sticker
            const key = `nsfw_check_${type}s`;
            if (config[key] !== undefined) {
                await db.updateGuildConfig(ctx.chat.id, { [key]: config[key] ? 0 : 1 });
            }
        } else if (data.startsWith('nsf_log_')) {
            // Log toggle for media_delete
            const logKey = 'media_delete';

            // Get current log events
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

            // Toggle
            logEvents[logKey] = !logEvents[logKey];
            await db.updateGuildConfig(ctx.chat.id, { log_events: logEvents });
        } else if (data === 'nsf_tier') {
            const current = config.media_tier_bypass ?? 2;
            const tiers = [0, 1, 2, 3, -1];
            const idx = tiers.indexOf(current);
            const next = tiers[(idx + 1) % tiers.length];
            await db.updateGuildConfig(ctx.chat.id, { media_tier_bypass: next });
        }

        await ui.sendConfigUI(ctx, db, true, fromSettings);
    });
}

module.exports = {
    registerCommands
};
