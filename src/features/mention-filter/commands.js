const logic = require('./logic');
const actions = require('./actions');
const ui = require('./ui');
const { isAdmin, isFromSettingsMenu } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');

function registerCommands(bot, db) {
    // Middleware: mention detection on all text messages
    bot.on('message:text', async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip admins
        if (await isAdmin(ctx, 'mention-filter')) return next();

        // Config check
        const config = await db.getGuildConfig(ctx.chat.id);
        if (!config.mention_filter_enabled) return next();

        // Scan for suspicious external mentions
        const verdict = await logic.scanMessage(ctx, config);
        if (verdict) {
            await actions.executeAction(ctx, config, verdict);
            // If action is delete, don't continue processing
            if (config.mention_filter_action === 'delete' || verdict.type === 'gbanned') {
                return;
            }
        }

        await next();
    });

    // Also check captions on media messages
    bot.on('message:caption', async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip admins
        if (await isAdmin(ctx, 'mention-filter')) return next();

        // Config check
        const config = await db.getGuildConfig(ctx.chat.id);
        if (!config.mention_filter_enabled) return next();

        // Scan for suspicious external mentions
        const verdict = await logic.scanMessage(ctx, config);
        if (verdict) {
            await actions.executeAction(ctx, config, verdict);
            if (config.mention_filter_action === 'delete' || verdict.type === 'gbanned') {
                return;
            }
        }

        await next();
    });

    // UI Handlers
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith('mnt_')) return next();

        const config = await db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === 'mnt_close') return ctx.deleteMessage();

        if (data === 'mnt_toggle') {
            await db.updateGuildConfig(ctx.chat.id, {
                mention_filter_enabled: !config.mention_filter_enabled
            });
        } else if (data === 'mnt_action') {
            // Cycle through actions: report_only -> delete -> report_only
            const newAction = config.mention_filter_action === 'delete' ? 'report_only' : 'delete';
            await db.updateGuildConfig(ctx.chat.id, { mention_filter_action: newAction });
        } else if (data === 'mnt_notify') {
            await db.updateGuildConfig(ctx.chat.id, {
                mention_filter_notify: !config.mention_filter_notify
            });
        }

        await ui.sendConfigUI(ctx, db, true, fromSettings);
    });

    logger.info('[mention-filter] Commands registered');
}

module.exports = {
    registerCommands
};
