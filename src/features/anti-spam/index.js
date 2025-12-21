// ============================================================================
// ANTI-SPAM MODULE
// ============================================================================
// SCOPO: Rilevamento spam tramite analisi volume e ripetizione messaggi.
// ============================================================================

const stats = require('./stats');
const actions = require('./actions');
const commands = require('./commands');
const ui = require('./ui');

function init(database) {
    stats.init(database);
}

function register(bot, database) {
    // actions.init requires bot instance
    actions.init(database, bot);
    commands.registerCommands(bot, database);
}

module.exports = {
    init,
    register,
    sendConfigUI: ui.sendConfigUI,
    // Utils exported for testing if needed
    getStats: stats.getStats
};
