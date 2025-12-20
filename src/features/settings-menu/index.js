const commands = require('./commands');
const ui = require('./ui');
const logger = require('../../middlewares/logger');

let db = null;
let _botInstance = null;

function register(bot, database) {
    db = database;
    _botInstance = bot;
    ui.setDb(database);  // Pass db to UI for staff group check
    commands.registerCommands(bot, db);
    logger.info('[settings-menu] Module registered');
}

module.exports = { register };
