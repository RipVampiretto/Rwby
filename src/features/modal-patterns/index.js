// ============================================================================
// MODAL PATTERNS - Language/Category Based Spam Detection
// ============================================================================
// SCOPO: Sistema di pattern globali organizzati per lingua e categoria.
// ============================================================================

const logic = require('./logic');
const commands = require('./commands');
const manage = require('./manage');
const ui = require('./ui');

let db = null;

function register(bot, database) {
    db = database;
    logic.init(database);
    manage.init(database);
    commands.registerCommands(bot, database);
}

function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    register,
    sendConfigUI,
    // Export SuperAdmin API
    listModals: manage.listModals,
    getModal: manage.getModal,
    upsertModal: manage.upsertModal,
    addPatternsToModal: manage.addPatternsToModal,
    removePatternsFromModal: manage.removePatternsFromModal,
    deleteModal: manage.deleteModal,
    toggleModal: manage.toggleModal,
    updateModalAction: manage.updateModalAction,
    refreshCache: logic.refreshCache
};
