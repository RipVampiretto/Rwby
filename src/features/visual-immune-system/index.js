const commands = require('./commands');
const ui = require('./ui');
const logic = require('./logic');
const logger = require('../../middlewares/logger');

let db = null;
let _botInstance = null;

function register(bot, database) {
    db = database;
    _botInstance = bot;
    commands.registerCommands(bot, db);
    logger.info('[visual-immune-system] Module registered');
}

// Exports for other modules or testing
function sendConfigUI(ctx) {
    return ui.sendConfigUI(ctx, db);
}

module.exports = {
    register,
    sendConfigUI
};
