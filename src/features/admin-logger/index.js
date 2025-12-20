// ============================================================================
// ADMIN LOGGER MODULE
// ============================================================================
// SCOPO: Sistema centralizzato di logging per azioni del BOT.
// ============================================================================

const core = require('./core');
const commands = require('./commands');
const ui = require('./ui');

let db = null;

function register(bot, database) {
    db = database;
    // Initialize core logic
    core.init(bot, database);

    // Register commands
    commands.registerCommands(bot, database);
}

function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    register,
    getLogEvent: () => core.logEvent,
    sendConfigUI
};
