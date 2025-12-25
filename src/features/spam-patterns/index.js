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

function init(database) {
    db = database;
    logic.init(database);
    manage.init(database);
}

function register(bot) {
    commands.registerCommands(bot, db);
}

function sendConfigUI(ctx, isEdit = false) {
    return ui.sendConfigUI(ctx, db, isEdit);
}

module.exports = {
    init,
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
    toggleModalHidden: manage.toggleModalHidden,
    updateModalAction: manage.updateModalAction,
    refreshCache: logic.refreshCache
};
