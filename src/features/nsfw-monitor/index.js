// ============================================================================
// NSFW MONITOR - Image and Video Content Analysis
// ============================================================================
// SCOPO: Analisi contenuti multimediali (foto/video/gif) per NSFW.
// Usa Vision LLM locale (LM Studio)
// ============================================================================

const commands = require('./commands');
const ui = require('./ui');
const loggerUtil = require('../../middlewares/logger');

let db = null;

function register(bot, database) {
    db = database;
    commands.registerCommands(bot, database);
    loggerUtil.info('[nsfw-monitor] Module registered and ready');
}

function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    return ui.sendConfigUI(ctx, db, isEdit, fromSettings);
}

module.exports = {
    register,
    sendConfigUI
};
