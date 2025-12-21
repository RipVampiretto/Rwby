// ============================================================================
// INTEL NETWORK MODULE
// ============================================================================
// SCOPO: Rete federata per condivisione intelligence tra gruppi.
// ============================================================================

const trust = require('./trust');
const reporting = require('./reporting');
const commands = require('./commands');
const ui = require('./ui');

function init(database) {
    trust.init(database);
}

function register(bot, database) {
    // Note: reporting.init requires bot instance
    reporting.init(database, bot);
    commands.registerCommands(bot, database);
}

module.exports = {
    init,
    register,
    sendConfigUI: ui.sendConfigUI,
    getGuildTrust: trust.getGuildTrust
};
