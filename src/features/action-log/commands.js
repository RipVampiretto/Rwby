const { sendConfigUI } = require('./ui');

/**
 * Register command handlers
 * @param {object} bot - Bot instance
 * @param {object} db - Database instance
 */
function registerCommands(bot, db) {
    // Action Handlers for Config
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith('log_')) return next();

        const config = await db.getGuildConfig(ctx.chat.id);
        let logEvents = {};
        if (config.log_events) {
            if (typeof config.log_events === 'string') {
                try {
                    logEvents = JSON.parse(config.log_events);
                } catch (e) {}
            } else if (typeof config.log_events === 'object') {
                logEvents = config.log_events;
            }
            if (Array.isArray(logEvents)) logEvents = {};
        }

        if (data === 'log_close') {
            await ctx.deleteMessage();
        } else if (data.startsWith('log_t:')) {
            // Toggle format: log_t:module_action (e.g., log_t:lang_delete)
            const key = data.split(':')[1];
            logEvents[key] = !logEvents[key];
            await db.updateGuildConfig(ctx.chat.id, { log_events: JSON.stringify(logEvents) });
            await sendConfigUI(ctx, db, true, true);
        } else {
            return next();
        }
    });
}

module.exports = {
    registerCommands
};
