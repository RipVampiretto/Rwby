// ============================================================================
// ANTI-SPAM MODULE
// ============================================================================
// SCOPO: Rilevamento spam tramite analisi volume e ripetizione messaggi.
// ============================================================================

const stats = require('./stats');
const actions = require('./actions');
const commands = require('./commands');
const ui = require('./ui');

function register(bot, database) {
    stats.init(database);
    actions.init(database, bot);
    commands.registerCommands(bot, database);
}

module.exports = {
    register,
    sendConfigUI: ui.sendConfigUI,
    // Utils exported for testing if needed
    getStats: stats.getStats
};
