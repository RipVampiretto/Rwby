// ============================================================================
// LANGUAGE MONITOR MODULE
// ============================================================================
// SCOPO: Rilevamento lingua messaggi e enforcement lingue permesse.
// ============================================================================

const commands = require('./commands');
const ui = require('./ui');
// detection is loaded internally by commands

let db = null;

function init(database) {
    db = database;
}

function register(bot) {
    commands.registerCommands(bot, db);
}

function sendConfigUI(ctx, isEdit = false) {
    return ui.sendConfigUI(ctx, db, isEdit);
}

module.exports = {
    init,
    register,
    sendConfigUI
};
