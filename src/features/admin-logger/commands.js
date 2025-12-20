const { isAdmin } = require('./utils');
const { sendConfigUI } = require('./ui');
const { isFromSettingsMenu } = require('../../utils/error-handlers');

/**
 * Register command handlers
 * @param {object} bot - Bot instance
 * @param {object} db - Database instance
 */
function registerCommands(bot, db) {
    // Action Handlers for Config
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("log_")) return next();

        const config = db.getGuildConfig(ctx.chat.id);
        let logEvents = {};
        if (config.log_events) {
            try { logEvents = JSON.parse(config.log_events); } catch (e) { }
            if (Array.isArray(logEvents)) logEvents = {}; // Reset if old format
        }
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === "log_close") {
            await ctx.deleteMessage();
        }
        else if (data === "log_set_channel") {
            await ctx.answerCallbackQuery("Usa /setlogchannel <ID> nel gruppo");
        }
        else if (data.startsWith("log_t:")) {
            // Toggle format: log_t:module_action (e.g., log_t:lang_delete)
            const key = data.split(":")[1];
            logEvents[key] = !logEvents[key];
            db.updateGuildConfig(ctx.chat.id, { log_events: JSON.stringify(logEvents) });
            await sendConfigUI(ctx, db, true, fromSettings);
        }
    });

    bot.command("setlogchannel", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        if (!await isAdmin(ctx)) return;

        const args = ctx.message.text.split(' ').slice(1);

        if (!args[0]) {
            return ctx.reply("❌ Specifica l'ID del canale.\nUso: `/setlogchannel -100123456789`", { parse_mode: 'Markdown' });
        }

        const targetId = parseInt(args[0]);
        if (isNaN(targetId)) {
            return ctx.reply("❌ ID non valido. Usa: /setlogchannel -100123456789");
        }

        // Test permission by sending a message
        try {
            const testMsg = await bot.api.sendMessage(targetId, "✅ Test connessione log channel riuscito.");
            await bot.api.deleteMessage(targetId, testMsg.message_id);

            db.updateGuildConfig(ctx.chat.id, { log_channel_id: targetId });
            await ctx.reply(`✅ Canale log impostato: \`${targetId}\``, { parse_mode: 'Markdown' });
        } catch (e) {
            await ctx.reply(`❌ Impossibile inviare messaggi nel canale \`${targetId}\`.\nAssicurati che il bot sia admin con permessi di scrittura.`, { parse_mode: 'Markdown' });
        }
    });
}

module.exports = {
    registerCommands
};
