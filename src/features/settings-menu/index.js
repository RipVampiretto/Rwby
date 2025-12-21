const commands = require('./commands');
const ui = require('./ui');
const logger = require('../../middlewares/logger');

let db = null;
let _botInstance = null;

function init(database) {
    db = database;
    ui.setDb(database);  // Pass db to UI for staff group check
}

function register(bot) {
    _botInstance = bot;
    commands.registerCommands(bot, db);
    logger.info('[settings-menu] Module registered');
}

module.exports = {
    init,
    register
};
