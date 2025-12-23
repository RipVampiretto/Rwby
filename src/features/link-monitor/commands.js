const logic = require('./logic');
const actions = require('./actions');
const ui = require('./ui');
const { isAdmin, isFromSettingsMenu } = require('../../utils/error-handlers');

function registerCommands(bot, db) {
    // Middleware: link detection
    bot.on('message:text', async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip admins
        if (await isAdmin(ctx, 'link-monitor')) return next();

        // Config check
        const config = await db.getGuildConfig(ctx.chat.id);
        if (!config.link_enabled) return next();

        // Always use global sync - no tier bypass
        const verdict = await logic.scanMessage(ctx, config);
        if (verdict) {
            await actions.executeAction(ctx, verdict);
            if (verdict.type === 'blacklist') return;
        }

        await next();
    });

    // UI Handlers
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith('lnk_')) return next();

        const config = await db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === 'lnk_close') return ctx.deleteMessage();

        if (data === 'lnk_toggle') {
            await db.updateGuildConfig(ctx.chat.id, { link_enabled: config.link_enabled ? 0 : 1 });
        } else if (data === 'lnk_log_delete') {
            // Log toggle for link_delete
            let logEvents = {};
            if (config.log_events) {
                if (typeof config.log_events === 'string') {
                    try { logEvents = JSON.parse(config.log_events); } catch (e) { }
                } else if (typeof config.log_events === 'object') {
                    logEvents = config.log_events;
                }
            }
            logEvents['link_delete'] = !logEvents['link_delete'];
            await db.updateGuildConfig(ctx.chat.id, { log_events: logEvents });
        }

        await ui.sendConfigUI(ctx, db, true, fromSettings);
    });
}

module.exports = {
    registerCommands
};
