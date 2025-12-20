const commands = require('./commands');
const actions = require('./actions');
const ui = require('./ui');
const logger = require('../../middlewares/logger');

let db = null;
let _botInstance = null;

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Clean expired votes periodically
    setInterval(() => actions.processExpiredVotes(bot, db), 60000);

    commands.registerCommands(bot, db);
    logger.info('[vote-ban] Module registered');
}

function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    register,
    sendConfigUI
};
