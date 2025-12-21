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

function init(database) {
    db = database;
    logic.init(database);
    wizard.init();
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
