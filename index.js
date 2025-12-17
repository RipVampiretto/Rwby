require('dotenv').config();
const { Bot, GrammyError, HttpError } = require("grammy");
const isAdmin = require("./src/middlewares/isAdmin");
const logger = require("./src/middlewares/logger");

// Init bot with token from env
const bot = new Bot(process.env.BOT_TOKEN);

bot.use(isAdmin);

// Middleware per il logging
bot.use(async (ctx, next) => {
    logger.info(`[${ctx.from?.first_name || 'Generic'}] ${ctx.message?.text || 'Update received'}`);
    await next();
});

bot.command("start", (ctx) => ctx.reply("Ciao! Sono il tuo bot di moderazione."));

bot.on("message", async (ctx) => {
    // Basic logging
    // Basic logging - Handled by middleware
    // console.log(`[${ctx.from.first_name}]: ${ctx.message.text}`);

    // Future moderation logic here
});

bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof GrammyError) {
        console.error("Error in request:", e.description);
    } else if (e instanceof HttpError) {
        console.error("Could not contact Telegram:", e);
    } else {
        console.error("Unknown error:", e);
    }
});

console.log("Bot avviato...");
bot.start();
