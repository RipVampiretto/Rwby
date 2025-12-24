// ============================================================================
// MENTION FILTER - External @username Scam Detection
// ============================================================================
// SCOPO: Rileva menzioni di utenti esterni al gruppo e usa AI per classificare
// potenziali scam/recruitment fraud. Gli utenti esterni non nel DB o non nel
// gruppo corrente vengono analizzati per identificare pattern di scam.
// ============================================================================

const logic = require('./logic');
const actions = require('./actions');
const commands = require('./commands');
const ui = require('./ui');
const logger = require('../../middlewares/logger');

let db = null;

function init(database) {
    db = database;
    logic.init(database);
    actions.init(database);
    logger.info('[mention-filter] Module initialized');
}

function register(bot) {
    commands.registerCommands(bot, db);
    logger.info('[mention-filter] Module registered and ready');
}

function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    init,
    register,
    sendConfigUI
};
