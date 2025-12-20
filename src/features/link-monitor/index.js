// ============================================================================
// LINK MONITOR MODULE
// ============================================================================
// SCOPO: Controllo link/URL nei messaggi con whitelist/blacklist domini GLOBALI.
// ============================================================================

const logic = require('./logic');
const commands = require('./commands');
const ui = require('./ui');

function register(bot, database) {
    logic.init(database);
    commands.registerCommands(bot, database);
}

module.exports = {
    register,
    sendConfigUI: ui.sendConfigUI
};
