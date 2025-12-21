// ============================================================================
// ANTI-EDIT ABUSE MODULE
// ============================================================================
// SCOPO: Rilevare abusi della funzione modifica messaggio.
// ============================================================================

const core = require('./core');
const commands = require('./commands');
const ui = require('./ui');

let db = null;

function init(database) {
    db = database;
    // Initialize core (snapshots)
    core.init(database);
}

function register(bot) {
    // Register commands and listeners
    commands.registerCommands(bot, db);
}

function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    init,
    register,
    sendConfigUI
};
