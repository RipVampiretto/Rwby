// ============================================================================
// KEYWORD MONITOR MODULE
// ============================================================================
// SCOPO: Filtro parole/frasi vietate con supporto regex.
// ============================================================================

const logic = require('./logic');
const commands = require('./commands');
const ui = require('./ui');
const wizard = require('./wizard');

let db = null;

function register(bot, database) {
    db = database;
    logic.init(database);
    wizard.init();
    commands.registerCommands(bot, database);
}

function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    register,
    sendConfigUI
};
