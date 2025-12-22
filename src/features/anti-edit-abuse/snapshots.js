const { handleCriticalError } = require('../../utils/error-handlers');

let db = null;

function init(database) {
    db = database;
    // Clean snapshots periodically (every hour)
    setInterval(cleanupSnapshots, 3600000);
}

async function saveSnapshot(message) {
    if (!db) return;
    try {
        const hasLink = /(https?:\/\/[^\s]+)/.test(message.text || '');
        await db.query(
            `
            INSERT INTO message_snapshots (message_id, chat_id, user_id, original_text, original_has_link, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (message_id, chat_id) DO NOTHING
        `,
            [message.message_id, message.chat.id, message.from.id, message.text, hasLink]
        );
    } catch (e) {
        // Ignore unique constraint or other minor errors
    }
}

async function getSnapshot(messageId, chatId) {
    if (!db) return null;
    return await db.queryOne('SELECT * FROM message_snapshots WHERE message_id = $1 AND chat_id = $2', [
        messageId,
        chatId
    ]);
}

async function cleanupSnapshots() {
    if (!db) return;
    try {
        await db.query("DELETE FROM message_snapshots WHERE created_at < NOW() - INTERVAL '1 day'");
    } catch (e) {
        handleCriticalError('anti-edit-abuse', 'cleanupSnapshots', e);
    }
}

module.exports = {
    init,
    saveSnapshot,
    getSnapshot,
    cleanupSnapshots
};
