// ============================================================================
// LINK MONITOR MODULE
// ============================================================================
// SCOPO: Controllo link/URL nei messaggi con whitelist/blacklist domini GLOBALI.
// ============================================================================

const logic = require('./logic');
const commands = require('./commands');
const ui = require('./ui');

let db = null;

function init(database) {
    db = database;
    logic.init(database);
}

function register(bot) {
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
