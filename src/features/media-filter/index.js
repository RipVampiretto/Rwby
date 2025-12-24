// ============================================================================
// NSFW MONITOR - Image and Video Content Analysis
// ============================================================================
// SCOPO: Analisi contenuti multimediali (foto/video/gif) per NSFW.
// Usa Vision LLM locale (LM Studio)
// ============================================================================

const commands = require('./commands');
const ui = require('./ui');
const logger = require('../../middlewares/logger');

let db = null;

function init(database) {
    db = database;
}

function register(bot) {
    commands.registerCommands(bot, db);
    logger.info('[media-filter] Module registered and ready');
}

function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    init,
    register,
    sendConfigUI
};
