// ============================================================================
// LANGUAGE MONITOR MODULE
// ============================================================================
// SCOPO: Rilevamento lingua messaggi e enforcement lingue permesse.
// ============================================================================

const commands = require('./commands');
const ui = require('./ui');
// detection is loaded internally by commands

let db = null;

function register(bot, database) {
    db = database;
    commands.registerCommands(bot, database);
}

function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    register,
    sendConfigUI
};
