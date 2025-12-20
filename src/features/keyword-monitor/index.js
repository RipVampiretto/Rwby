// ============================================================================
// KEYWORD MONITOR MODULE
// ============================================================================
// SCOPO: Filtro parole/frasi vietate con supporto regex.
// ============================================================================

const logic = require('./logic');
const commands = require('./commands');
const ui = require('./ui');
const wizard = require('./wizard');

function register(bot, database) {
    logic.init(database);
    wizard.init();
    commands.registerCommands(bot, database);
}

module.exports = {
    register,
    sendConfigUI: ui.sendConfigUI
};
