// ============================================================================
// INTEL NETWORK MODULE
// ============================================================================
// SCOPO: Rete federata per condivisione intelligence tra gruppi.
// ============================================================================

const trust = require('./trust');
const reporting = require('./reporting');
const commands = require('./commands');
const ui = require('./ui');

function register(bot, database) {
    trust.init(database);
    reporting.init(database, bot);
    commands.registerCommands(bot, database);
}

module.exports = {
    register,
    sendConfigUI: ui.sendConfigUI,
    getGuildTrust: trust.getGuildTrust
};
