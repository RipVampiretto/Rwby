// ============================================================================
// ANTI-EDIT ABUSE MODULE
// ============================================================================
// SCOPO: Rilevare abusi della funzione modifica messaggio.
// ============================================================================

const core = require('./core');
const commands = require('./commands');
const ui = require('./ui');

function register(bot, database) {
    // Initialize core (snapshots)
    core.init(database);

    // Register commands and listeners
    commands.registerCommands(bot, database);
}

module.exports = {
    register,
    sendConfigUI: ui.sendConfigUI
};
