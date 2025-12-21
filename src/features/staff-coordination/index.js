const commands = require('./commands');
const logic = require('./logic');
const ui = require('./ui');
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
}

function reviewQueue(params) {
    return logic.reviewQueue(_botInstance, db, params);
}

function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    init,
    register,
    reviewQueue,
    sendConfigUI
};
