// ============================================================================
// ADMIN LOGGER MODULE
// ============================================================================
// SCOPO: Sistema centralizzato di logging per azioni del BOT.
// ============================================================================

const core = require('./core');
const commands = require('./commands');
const ui = require('./ui');

let db = null;

function init(database) {
    db = database;
}

function register(bot) {
    // Initialize core logic
    core.init(bot, db);

    // Register commands
    commands.registerCommands(bot, db);
}

function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    init,
    register,
    getLogEvent: () => core.logEvent,
    sendConfigUI
};
