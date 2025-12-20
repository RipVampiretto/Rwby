// ============================================================================
// ANTI-EDIT ABUSE MODULE
// ============================================================================
// SCOPO: Rilevare abusi della funzione modifica messaggio.
// ============================================================================

const core = require('./core');
const commands = require('./commands');
const ui = require('./ui');

let db = null;

function register(bot, database) {
    db = database;
    // Initialize core (snapshots)
    core.init(database);

    // Register commands and listeners
    commands.registerCommands(bot, database);
}

function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    register,
    sendConfigUI
};
