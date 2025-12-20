const commands = require('./commands');
const logger = require('../../middlewares/logger');

let db = null;
let _botInstance = null;

function register(bot, database) {
    db = database;
    _botInstance = bot;
    commands.registerCommands(bot, db);
    logger.info('[settings-menu] Module registered');
}

module.exports = { register };
