const { handleNewMember, handleCaptchaCallback } = require('./core');
const { handleCallback } = require('./commands');
const { handleMessage } = require('./wizard');
const ui = require('./ui');
const logger = require('../../middlewares/logger');

function register(bot, db) {
    // Events
    // Events
    bot.on('chat_member', handleNewMember);
    bot.on('message:new_chat_members', handleNewMember);

    // Callbacks
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (data.startsWith('wc:')) {
            return handleCaptchaCallback(ctx);
        }

        if (data.startsWith('wc_')) {
            return handleCallback(ctx);
        }

        return next();
    });

    // Wizard Message Listener
    // Needs to be high priority? Or just normal? 
    // It should check if wizard session exists.
    bot.on('message:text', async (ctx, next) => {
        const handled = await handleMessage(ctx);
        if (handled) return;
        return next();
    });

    // Expose UI function for settings menu
    // We can't easily export to other modules from here unless we structure it.
    // Instead, settings-menu should require this module's UI or we assign it to a global registry?
    // For now, let's modify settings-menu to import this UI.
}

module.exports = {
    register,
    ui // Export UI for settings menu to use
};
