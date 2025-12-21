const connection = require('./connection');
const schema = require('./schema');
const migrations = require('./migrations');
const userRepo = require('./repos/user');
const guildRepo = require('./repos/guild');

/**
 * Initialize database connection and create tables
 */
async function init() {
    // Initialize connection pool
    await connection.init();

    // Create tables
    await schema.createTables();

    // Run migrations
    await migrations.runMigrations();

    // Initialize guild config cache (enables sync getGuildConfig)
    await guildRepo.initCache();

    return connection.getPool();
}

module.exports = {
    init,
    getPool: connection.getPool,
    getDb: connection.getDb, // Compatibility wrapper for legacy code
    query: connection.query,
    queryOne: connection.queryOne,
    queryAll: connection.queryAll,

    // User Repository (async)
    getUser: userRepo.getUser,
    upsertUser: userRepo.upsertUser,
    setUserGlobalBan: userRepo.setUserGlobalBan,
    getGloballyBannedUsers: userRepo.getGloballyBannedUsers,
    isUserGloballyBanned: userRepo.isUserGloballyBanned,

    // Guild Repository (async)
    getGuildConfig: guildRepo.getGuildConfig,
    updateGuildConfig: guildRepo.updateGuildConfig,
    upsertGuild: guildRepo.upsertGuild
};
