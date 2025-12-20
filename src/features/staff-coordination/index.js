const commands = require('./commands');
const logic = require('./logic');
const ui = require('./ui');
const logger = require('../../middlewares/logger');

let db = null;
let _botInstance = null;

function register(bot, database) {
    db = database;
    _botInstance = bot;
    commands.registerCommands(bot, db);
    logger.info('[staff-coordination] Module registered');
}

function reviewQueue(params) {
    return logic.reviewQueue(_botInstance, db, params);
}

module.exports = {
    register,
    reviewQueue,
    sendConfigUI: ui.sendConfigUI
};
