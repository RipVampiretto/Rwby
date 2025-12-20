const { handleCriticalError } = require('../../utils/error-handlers');

let db = null;

function init(database) {
    db = database;
    // Clean snapshots periodically (every hour)
    setInterval(cleanupSnapshots, 3600000);
}

function saveSnapshot(message) {
    if (!db) return;
    try {
        const hasLink = /(https?:\/\/[^\s]+)/.test(message.text || '');
        db.getDb().prepare(`
            INSERT INTO message_snapshots (message_id, chat_id, user_id, original_text, original_has_link, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(message.message_id, message.chat.id, message.from.id, message.text, hasLink ? 1 : 0, new Date().toISOString());
    } catch (e) {
        // Ignore unique constraint or other minor errors
    }
}

function getSnapshot(messageId, chatId) {
    if (!db) return null;
    return db.getDb().prepare('SELECT * FROM message_snapshots WHERE message_id = ? AND chat_id = ?').get(messageId, chatId);
}

function cleanupSnapshots() {
    if (!db) return;
    try {
        db.getDb().prepare("DELETE FROM message_snapshots WHERE created_at < datetime('now', '-1 day')").run();
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
