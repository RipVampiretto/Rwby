// ============================================================================
// ADMIN LOGGER MODULE
// ============================================================================
// SCOPO: Sistema centralizzato di logging per azioni del BOT.
// ============================================================================

const core = require('./core');
const commands = require('./commands');
const ui = require('./ui');

function register(bot, database) {
    // Initialize core logic
    core.init(bot, database);

    // Register commands
    commands.registerCommands(bot, database);
}

module.exports = {
    register,
    getLogEvent: () => core.logEvent,
    sendConfigUI: ui.sendConfigUI
};
