// ============================================================================
// INTELLIGENT PROFILER MODULE
// ============================================================================
// SCOPO: Profilazione nuovi utenti (Tier 0) per rilevare comportamenti sospetti.
// ============================================================================

const logic = require('./logic');
const commands = require('./commands');
const ui = require('./ui');

function register(bot, database) {
    logic.init(database);
    commands.registerCommands(bot, database);
}

module.exports = {
    register,
    sendConfigUI: ui.sendConfigUI
};
