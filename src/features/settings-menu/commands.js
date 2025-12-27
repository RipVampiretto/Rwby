const ui = require('./ui');
const logic = require('./logic');
const { isAdmin } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');

function registerCommands(bot, db) {
    // Command: /settings
    bot.command('settings', async ctx => {
        logger.info(`[Settings] /settings command triggered by user ${ctx.from.id}`, ctx);

        if (ctx.chat.type === 'private') {
            logger.debug(`[Settings] /settings called in private chat, ignoring`, ctx);
            return; // Or handle differently
        }

        if (!(await isAdmin(ctx, 'settings-menu'))) {
            logger.warn(`[Settings] User ${ctx.from.id} is not admin, access denied`, ctx);
            return;
        }

        logger.debug(`[Settings] Sending main menu to user ${ctx.from.id}`, ctx);
        await ui.sendMainMenu(ctx);
    });

    // Callback: settings_main (Back function)
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;

        if (data === 'settings_main') {
            logger.info(`[Settings] Back to main menu requested`, ctx);
            await ui.sendMainMenu(ctx, true);
            return;
        }

        if (data.startsWith('set_goto:')) {
            const target = data.split(':')[1];
            logger.info(`[Settings] Navigation callback: target=${target}`, ctx);
            await logic.routeToFeature(ctx, target);
            return;
        }

        // UI Language selection
        if (data.startsWith('settings_ui_lang:')) {
            const langCode = data.split(':')[1];
            logger.info(`[Settings] Language selection callback: langCode=${langCode}`, ctx);
            await logic.handleLanguageChange(ctx, langCode);
            return;
        }

        if (data === 'settings_close') {
            logger.info(`[Settings] Menu closed by user`, ctx);
            try {
                await ctx.deleteMessage();
                logger.debug(`[Settings] Menu message deleted successfully`, ctx);
            } catch (e) {
                logger.error(`[Settings] Failed to delete menu message: ${e.message}`, ctx);
            }
            return;
        }

        await next();
    });
}

module.exports = {
    registerCommands
};

