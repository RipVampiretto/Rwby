const commands = require('./commands');
const logic = require('./logic');
const logger = require('../../middlewares/logger');

let db = null;
let _botInstance = null;

function register(bot, database) {
    db = database;
    _botInstance = bot;
    commands.registerCommands(bot, db);
    logger.info('[user-reputation] Module registered');
}

// Export logic functions needing db injection
function getUserTier(userId, guildId) {
    return logic.getUserTier(db, userId, guildId);
}

function getLocalFlux(userId, guildId) {
    return logic.getLocalFlux(db, userId, guildId);
}

function getGlobalFlux(userId) {
    return logic.getGlobalFlux(db, userId);
}

function modifyFlux(userId, guildId, delta, reason) {
    return logic.modifyFlux(db, userId, guildId, delta, reason);
}

module.exports = {
    register,
    getUserTier,
    getLocalFlux,
    getGlobalFlux,
    modifyFlux
};