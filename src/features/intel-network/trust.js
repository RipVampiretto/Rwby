let db = null;

function init(database) {
    db = database;
}

function getGuildTrust(guildId) {
    if (!db) return null;
    let row = db.getDb().prepare('SELECT * FROM guild_trust WHERE guild_id = ?').get(guildId);
    if (!row) {
        // Init row
        db.getDb().prepare('INSERT INTO guild_trust (guild_id) VALUES (?)').run(guildId);
        row = db.getDb().prepare('SELECT * FROM guild_trust WHERE guild_id = ?').get(guildId);
    }
    return row;
}

module.exports = {
    init,
    getGuildTrust
};
