// ============================================================================
// INTELLIGENT PROFILER MODULE
// ============================================================================
// SCOPO: Profilazione nuovi utenti (Tier 0) per rilevare comportamenti sospetti.
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

module.exports = {
    init,
    register,
    sendConfigUI: ui.sendConfigUI
};
