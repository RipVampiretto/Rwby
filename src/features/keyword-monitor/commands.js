const logic = require('./logic');
const actions = require('./actions');
const ui = require('./ui');
const { isAdmin, isFromSettingsMenu } = require('../../utils/error-handlers');

function registerCommands(bot, db) {
    // Middleware: keyword detection (global only)
    bot.on('message:text', async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip admins
        if (await isAdmin(ctx, 'keyword-monitor')) return next();

        // Config check
        const config = await db.getGuildConfig(ctx.chat.id);
        if (!config.keyword_enabled) return next();

        // Check against global intel for blacklisted words
        const match = await logic.scanMessage(ctx);
        if (match) {
            await actions.executeAction(ctx, config, match.word);
            return;
        }

        await next();
    });

    // UI Handlers
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith('wrd_')) return next();

        const config = await db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === 'wrd_close') return ctx.deleteMessage();

        if (data === 'wrd_toggle') {
            await db.updateGuildConfig(ctx.chat.id, { keyword_enabled: config.keyword_enabled ? 0 : 1 });
        } else if (data === 'wrd_log_delete') {
            // Log toggle
            let logEvents = {};
            if (config.log_events) {
                if (typeof config.log_events === 'string') {
                    try { logEvents = JSON.parse(config.log_events); } catch (e) { }
                } else if (typeof config.log_events === 'object') {
                    logEvents = config.log_events;
                }
            }
            logEvents['keyword_delete'] = !logEvents['keyword_delete'];
            await db.updateGuildConfig(ctx.chat.id, { log_events: logEvents });
        }

        await ui.sendConfigUI(ctx, db, true, fromSettings);
    });
}

module.exports = {
    registerCommands
};
