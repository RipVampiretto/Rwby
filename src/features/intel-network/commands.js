const ui = require('./ui');
const reporting = require('./reporting');
const { isAdmin, isFromSettingsMenu } = require('../../utils/error-handlers');

function registerCommands(bot, db) {
    // Command: /intel
    bot.command("intel", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        if (!await isAdmin(ctx, 'intel-network')) return;

        await ui.sendConfigUI(ctx);
    });

    // Command: /greport
    bot.command("greport", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        if (!await isAdmin(ctx, 'intel-network')) return;

        await reporting.handleReport(ctx);
    });

    bot.on("callback_query:data", async (ctx, next) => {
        if (ctx.callbackQuery.data === 'intel_close') return ctx.deleteMessage();
        if (ctx.callbackQuery.data === 'intel_noop') return ctx.answerCallbackQuery("Feature coming soon");

        // This is a placeholder for future settings handling
        // const fromSettings = isFromSettingsMenu(ctx);

        await next();
    });
}

module.exports = {
    registerCommands
};
