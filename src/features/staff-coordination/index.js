const commands = require('./commands');
const logic = require('./logic');
const ui = require('./ui');
const wizard = require('./wizard');
const logger = require('../../middlewares/logger');

let db = null;
let _botInstance = null;

function init(database) {
    db = database;
}

function register(bot) {
    _botInstance = bot;
    commands.registerCommands(bot, db);
    logger.info('[staff-coordination] Module registered');

    // Callbacks for Wizard and Deletion
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (data.startsWith('stf_wizard:') || data.startsWith('stf_del:') || data === 'stf_cancel') {
            if (db) return logic.handleCallback(ctx, db);
        }
        return next();
    });

    // Wizard Message Listener
    bot.on('message:text', async (ctx, next) => {
        const handled = await wizard.handleMessage(ctx);
        if (handled) return;
        return next();
    });
}

function reviewQueue(params) {
    return logic.reviewQueue(_botInstance, db, params);
}

function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    if (!db) {
        logger.warn('[staff-coordination] DB is null during sendConfigUI call');
        return ctx.answerCallbackQuery('⚠️ Staff module not initialized (disabled?).');
    }
    logger.debug('[staff-coordination] calling ui.sendConfigUI');
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    init,
    register,
    reviewQueue,
    sendConfigUI
};
