const ui = require('./ui');
const logic = require('./logic');
const { isAdmin } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');

function registerCommands(bot, db) {
    // Command: /settings
    bot.command("settings", async (ctx) => {
        logger.debug(`[settings-menu] /settings command triggered by ${ctx.from.id}`);
        if (ctx.chat.type === 'private') return; // Or handle differently
        if (!await isAdmin(ctx, 'settings-menu')) return;

        await ui.sendMainMenu(ctx);
    });

    // Callback: settings_main (Back function)
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (data === "settings_main") {
            await ui.sendMainMenu(ctx, true);
            return;
        }

        if (data.startsWith("set_goto:")) {
            const target = data.split(':')[1];
            await logic.routeToFeature(ctx, target);
            return;
        }

        // UI Language selection
        if (data.startsWith("settings_ui_lang:")) {
            const langCode = data.split(':')[1];
            await logic.handleLanguageChange(ctx, langCode);
            return;
        }

        if (data === 'settings_close') {
            await ctx.deleteMessage();
            return;
        }

        await next();
    });
}

module.exports = {
    registerCommands
};
