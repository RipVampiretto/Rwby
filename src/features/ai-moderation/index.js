// ============================================================================
// AI MODERATION MODULE
// ============================================================================
// SCOPO: Analisi intelligente contenuti tramite LLM locale (LM Studio).
// ============================================================================

const core = require('./core');
const context = require('./context');
const commands = require('./commands');
const ui = require('./ui');

let db = null;

function init(database) {
    db = database;
    // Initialize core
    core.init(database);
}

function register(bot) {
    // Register middleware
    context.registerContextMiddleware(bot);

    // Register commands
    commands.registerCommands(bot, db);
}

function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    init,
    register,
    sendConfigUI,
    analyzeMessage: core.analyzeMessage
};
