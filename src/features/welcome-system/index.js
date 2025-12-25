const { handleNewMember, handleCaptchaCallback, handleMemberLeft } = require('./core');
const { handleCallback } = require('./commands');
const { handleMessage } = require('./wizard');
const ui = require('./ui');
const logger = require('../../middlewares/logger');

let db = null;

function init(database) {
    db = database;
}

function register(bot) {
    // Events
    bot.on('chat_member', async (ctx, next) => {
        // Handle both joins and leaves in chat_member updates
        await handleNewMember(ctx);
        await handleMemberLeft(ctx);
        return next();
    });
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
    bot.on('message:text', async (ctx, next) => {
        const handled = await handleMessage(ctx);
        if (handled) return;
        return next();
    });
}

module.exports = {
    init,
    register,
    ui // Export UI for settings menu to use
};
