const connection = require('./connection');
const schema = require('./schema');
const migrations = require('./migrations');
const userRepo = require('./repos/user');
const guildRepo = require('./repos/guild');

/**
 * Initialize database connection and create tables
 */
async function init() {
    const db = await connection.init();

    // Create tables
    schema.createTables(db);

    // Run migrations
    migrations.runMigrations(db);

    return db;
}

module.exports = {
    init,
    getDb: connection.getDb,

    // User Repository
    getUser: userRepo.getUser,
    upsertUser: userRepo.upsertUser,
    setUserGlobalBan: userRepo.setUserGlobalBan,

    // Guild Repository
    getGuildConfig: guildRepo.getGuildConfig,
    updateGuildConfig: guildRepo.updateGuildConfig,
    upsertGuild: guildRepo.upsertGuild
};
