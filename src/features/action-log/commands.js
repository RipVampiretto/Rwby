/**
 * @fileoverview Handler callback per il modulo Action Log
 * @module features/action-log/commands
 *
 * @description
 * Gestisce tutti i callback dell'interfaccia di configurazione.
 * Prefissi callback supportati: `log_`
 */

const { sendConfigUI } = require('./ui');

/**
 * Registra gli handler dei callback.
 *
 * @param {import('grammy').Bot} bot - Istanza del bot
 * @param {Object} db - Istanza del database
 */
function registerCommands(bot, db) {
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith('log_')) return next();

        const config = await db.getGuildConfig(ctx.chat.id);

        // Parse eventi di log abilitati
        let logEvents = {};
        if (config.log_events) {
            if (typeof config.log_events === 'string') {
                try {
                    logEvents = JSON.parse(config.log_events);
                } catch (e) {}
            } else if (typeof config.log_events === 'object') {
                logEvents = config.log_events;
            }
            // Reset formato legacy (array)
            if (Array.isArray(logEvents)) logEvents = {};
        }

        if (data === 'log_close') {
            await ctx.deleteMessage();
        } else if (data.startsWith('log_t:')) {
            // Toggle formato: log_t:module_action (es. log_t:lang_delete)
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
