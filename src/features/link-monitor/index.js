// ============================================================================
// LINK MONITOR MODULE
// ============================================================================
// SCOPO: Controllo link/URL nei messaggi con whitelist/blacklist domini GLOBALI.
// ============================================================================

const logic = require('./logic');
const commands = require('./commands');
const ui = require('./ui');

let db = null;

function register(bot, database) {
    db = database;
    logic.init(database);
    commands.registerCommands(bot, database);
}

function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    register,
    sendConfigUI
};
