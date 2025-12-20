// ============================================================================
// AI MODERATION MODULE
// ============================================================================
// SCOPO: Analisi intelligente contenuti tramite LLM locale (LM Studio).
// ============================================================================

const core = require('./core');
const context = require('./context');
const commands = require('./commands');
const ui = require('./ui');

function register(bot, database) {
    // Initialize core
    core.init(database);

    // Register middleware
    context.registerContextMiddleware(bot);

    // Register commands
    commands.registerCommands(bot, database);
}

module.exports = {
    register,
    sendConfigUI: ui.sendConfigUI,
    analyzeMessage: core.analyzeMessage
};
