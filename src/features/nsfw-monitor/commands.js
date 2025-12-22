const logic = require('./logic');
const ui = require('./ui');
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

            logger.debug(`[nsfw-monitor] 📥 Media received - Chat: ${chatId}, User: ${userId}, MsgId: ${msgId}`);

            if (ctx.chat.type === 'private') {
                logger.debug(`[nsfw-monitor] ⏭️ Skipping: private chat`);
                return next();
            }

            // Skip admins
            if (await isAdmin(ctx, 'nsfw-monitor')) {
                logger.debug(`[nsfw-monitor] ⏭️ Skipping: user ${userId} is admin`);
                return next();
            }

            // Config check
            const config = db.getGuildConfig(ctx.chat.id);
            if (!config.nsfw_enabled) {
                logger.debug(`[nsfw-monitor] ⏭️ Skipping: NSFW monitor disabled for chat ${chatId}`);
                return next();
            }

            // Tier bypass (-1 = OFF, no bypass)
            const tierBypass = config.nsfw_tier_bypass ?? 2;
            if (tierBypass !== -1 && ctx.userTier !== undefined && ctx.userTier >= tierBypass) {
                logger.debug(
                    `[nsfw-monitor] ⏭️ Skipping: user ${userId} has tier ${ctx.userTier} (bypass >= ${tierBypass})`
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
            logger.info(`[nsfw-monitor] 🎬 Media type detected: ${mediaType} - Chat: ${chatId}, User: ${userId}`);

            // Skip animated stickers (they're Lottie files, not images)
            if (isSticker && ctx.message.sticker.is_animated) {
                logger.debug(`[nsfw-monitor] ⏭️ Skipping: animated sticker (not analyzable)`);
                return next();
            }

            if (isVideo && !config.nsfw_check_videos) {
                logger.debug(`[nsfw-monitor] ⏭️ Skipping: video check disabled`);
                return next();
            }
            if (isGif && !config.nsfw_check_gifs) {
                logger.debug(`[nsfw-monitor] ⏭️ Skipping: GIF check disabled`);
                return next();
            }
            if (isPhoto && !config.nsfw_check_photos) {
                logger.debug(`[nsfw-monitor] ⏭️ Skipping: photo check disabled`);
                return next();
            }
            // Stickers have their own check
            if (isSticker && !config.nsfw_check_stickers) {
                logger.debug(`[nsfw-monitor] ⏭️ Skipping: sticker check disabled`);
                return next();
            }

            logger.info(
                `[nsfw-monitor] ✅ Proceeding with analysis for ${mediaType} - Chat: ${chatId}, User: ${userId}`
            );

            // Download and analyze
            // Fire and forget to avoid blocking, but handle errors
            logic
                .processMedia(ctx, config)
                .catch(err => logger.error(`[nsfw-monitor] ❌ Process error: ${err.message}\n${err.stack}`));

            await next();
        }
    );

    // UI Handlers
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith('nsf_')) return next();

        const config = db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === 'nsf_close') return ctx.deleteMessage();

        // No-op for non-clickable buttons
        if (data === 'nsf_noop') {
            const i18n = require('../../i18n');
            return ctx.answerCallbackQuery(i18n.t(ctx.chat.id, 'nsfw.categories_ui.noop'));
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
            let blockedCategories = config.nsfw_blocked_categories;
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
            await db.updateGuildConfig(ctx.chat.id, { nsfw_blocked_categories: blockedCategories });

            // Refresh categories UI
            await ui.sendCategoriesUI(ctx, db, fromSettings);
            return;
        }

        if (data === 'nsf_toggle') {
            await db.updateGuildConfig(ctx.chat.id, { nsfw_enabled: config.nsfw_enabled ? 0 : 1 });
        } else if (data === 'nsf_test') {
            await logic.testConnection(ctx);
            return;
        } else if (data === 'nsf_act') {
            const acts = ['delete', 'ban', 'report_only'];
            let cur = config.nsfw_action || 'delete';
            if (!acts.includes(cur)) cur = 'delete';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 3];
            await db.updateGuildConfig(ctx.chat.id, { nsfw_action: nextAct });
        } else if (data === 'nsf_thr') {
            let thr = config.nsfw_threshold || 0.7;
            thr = thr >= 0.9 ? 0.5 : thr + 0.1;
            await db.updateGuildConfig(ctx.chat.id, { nsfw_threshold: parseFloat(thr.toFixed(1)) });
        } else if (data.startsWith('nsf_tog_')) {
            const type = data.split('_')[2]; // photo, video, gif, sticker
            const key = `nsfw_check_${type}s`;
            if (config[key] !== undefined) {
                await db.updateGuildConfig(ctx.chat.id, { [key]: config[key] ? 0 : 1 });
            }
        } else if (data === 'nsf_tier') {
            const current = config.nsfw_tier_bypass ?? 2;
            const tiers = [0, 1, 2, 3, -1];
            const idx = tiers.indexOf(current);
            const next = tiers[(idx + 1) % tiers.length];
            await db.updateGuildConfig(ctx.chat.id, { nsfw_tier_bypass: next });
        }

        await ui.sendConfigUI(ctx, db, true, fromSettings);
    });
}

module.exports = {
    registerCommands
};
