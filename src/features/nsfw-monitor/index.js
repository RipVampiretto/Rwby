// ============================================================================
// NSFW MONITOR - Image and Video Content Analysis
// ============================================================================
// SCOPO: Analisi contenuti multimediali (foto/video/gif) per NSFW.
// Usa Vision LLM locale (LM Studio)
// ============================================================================

const commands = require('./commands');
const ui = require('./ui');
const loggerUtil = require('../../middlewares/logger');

function register(bot, database) {
    commands.registerCommands(bot, database);
    loggerUtil.info('[nsfw-monitor] Module registered and ready');
}

module.exports = {
    register,
    sendConfigUI: ui.sendConfigUI
};
