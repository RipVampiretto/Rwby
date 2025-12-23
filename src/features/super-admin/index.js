const commands = require('./commands');
const logic = require('./logic');
const logger = require('../../middlewares/logger');

let db = null;
let _botInstance = null;

function init(database) {
    db = database;
}

function register(bot) {
    _botInstance = bot;

    // Init Cron
    setInterval(() => logic.cleanupPendingDeletions(db, bot), 3600000); // 1h

    commands.registerCommands(bot, db);
    logger.info('[super-admin] Module registered');
}

function forwardToParliament(params) {
    return logic.forwardToParliament(_botInstance, db, params);
}

function forwardMediaToParliament(topic, ctx, caption, customKeyboard) {
    return logic.forwardMediaToParliament(_botInstance, db, topic, ctx, caption, customKeyboard);
}

function sendGlobalLog(event) {
    return logic.sendGlobalLog(_botInstance, db, event);
}

function syncGlobalBansToGuild(guildId) {
    return logic.syncGlobalBansToGuild(_botInstance, db, guildId);
}

module.exports = {
    init,
    register,
    forwardToParliament,
    forwardMediaToParliament,
    sendGlobalLog,
    syncGlobalBansToGuild
};
