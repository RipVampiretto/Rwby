let db = null;

function init(database) {
    db = database;
}

async function getStats(userId, guildId) {
    if (!db) return null;
    let stats = await db.queryOne('SELECT * FROM user_active_stats WHERE user_id = $1 AND guild_id = $2', [
        userId,
        guildId
    ]);
    if (!stats) {
        stats = {
            user_id: userId,
            guild_id: guildId,
            msg_count_60s: 0,
            msg_count_10s: 0,
            duplicate_count: 0,
            last_msg_content: null,
            last_msg_ts: null
        };
    }
    return stats;
}

async function updateStats(stats) {
    if (!db) return;
    await db.query(
        `
        INSERT INTO user_active_stats (user_id, guild_id, msg_count_60s, msg_count_10s, last_msg_content, last_msg_ts, duplicate_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT(user_id, guild_id) DO UPDATE SET
            msg_count_60s = $3, msg_count_10s = $4, last_msg_content = $5, last_msg_ts = $6, duplicate_count = $7
    `,
        [
            stats.user_id,
            stats.guild_id,
            stats.msg_count_60s,
            stats.msg_count_10s,
            stats.last_msg_content,
            stats.last_msg_ts || new Date().toISOString(),
            stats.duplicate_count
        ]
    );
}

module.exports = {
    init,
    getStats,
    updateStats
};
