// ============================================================================
// LANGUAGE MONITOR MODULE
// ============================================================================
// SCOPO: Rilevamento lingua messaggi e enforcement lingue permesse.
// ============================================================================

const commands = require('./commands');
const ui = require('./ui');
// detection is loaded internally by commands

function register(bot, database) {
    commands.registerCommands(bot, database);
}

module.exports = {
    register,
    sendConfigUI: ui.sendConfigUI
};
