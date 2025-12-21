let db = null;

function init(database) {
    db = database;
}

async function getGuildTrust(guildId) {
    if (!db) return null;
    let row = await db.queryOne('SELECT * FROM guild_trust WHERE guild_id = $1', [guildId]);
    if (!row) {
        await db.query('INSERT INTO guild_trust (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [guildId]);
        row = await db.queryOne('SELECT * FROM guild_trust WHERE guild_id = $1', [guildId]);
    }
    return row;
}

module.exports = {
    init,
    getGuildTrust
};
