const logic = require('./logic');
const logger = require('../../middlewares/logger');

let db = null;

function init(database) {
    db = database;
}

// ============================================================================
// GUILD MODAL OVERRIDES
// ============================================================================

function toggleGuildModal(guildId, modalId) {
    if (!db) return null;
    try {
        const current = logic.isModalEnabledForGuild(guildId, modalId);
        const newState = current ? 0 : 1;

        db.getDb().prepare(`
            INSERT INTO guild_modal_overrides (guild_id, modal_id, enabled)
            VALUES (?, ?, ?)
            ON CONFLICT(guild_id, modal_id) DO UPDATE SET enabled = ?
        `).run(guildId, modalId, newState, newState);

        return newState;
    } catch (e) {
        logger.error(`[modal-patterns] Failed to toggle guild modal: ${e.message}`);
        return null;
    }
}

// ============================================================================
// SUPERADMIN MODAL MANAGEMENT
// ============================================================================

function listModals(language = null) {
    if (!db) return [];
    let query = "SELECT * FROM spam_modals ORDER BY language, category";
    let modals;

    if (language) {
        query = "SELECT * FROM spam_modals WHERE language = ? ORDER BY category";
        modals = db.getDb().prepare(query).all(language);
    } else {
        modals = db.getDb().prepare(query).all();
    }
    return modals;
}

function getModal(language, category) {
    if (!db) return null;
    return db.getDb().prepare(
        "SELECT * FROM spam_modals WHERE language = ? AND category = ?"
    ).get(language, category);
}

function upsertModal(language, category, patterns, action = 'report_only', threshold = 0.6, createdBy = null) {
    if (!db) return;
    const patternsJson = JSON.stringify(patterns);

    db.getDb().prepare(`
        INSERT INTO spam_modals (language, category, patterns, action, similarity_threshold, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(language, category) DO UPDATE SET
            patterns = ?,
            action = ?,
            similarity_threshold = ?,
            updated_at = CURRENT_TIMESTAMP
    `).run(language, category, patternsJson, action, threshold, createdBy,
        patternsJson, action, threshold);

    logic.refreshCache();
}

function addPatternsToModal(language, category, newPatterns) {
    const modal = getModal(language, category);
    if (!modal) return false;

    const existing = logic.safeJsonParse(modal.patterns, []);
    const combined = [...new Set([...existing, ...newPatterns])];

    db.getDb().prepare(
        "UPDATE spam_modals SET patterns = ?, updated_at = CURRENT_TIMESTAMP WHERE language = ? AND category = ?"
    ).run(JSON.stringify(combined), language, category);

    logic.refreshCache();
    return true;
}

function removePatternsFromModal(language, category, patternsToRemove) {
    const modal = getModal(language, category);
    if (!modal) return false;

    const existing = logic.safeJsonParse(modal.patterns, []);
    const filtered = existing.filter(p => !patternsToRemove.includes(p));

    db.getDb().prepare(
        "UPDATE spam_modals SET patterns = ?, updated_at = CURRENT_TIMESTAMP WHERE language = ? AND category = ?"
    ).run(JSON.stringify(filtered), language, category);

    logic.refreshCache();
    return true;
}

function deleteModal(language, category) {
    if (!db) return false;
    const result = db.getDb().prepare(
        "DELETE FROM spam_modals WHERE language = ? AND category = ?"
    ).run(language, category);

    logic.refreshCache();
    return result.changes > 0;
}

function toggleModal(language, category) {
    if (!db) return null;
    const modal = getModal(language, category);
    if (!modal) return null;

    const newState = modal.enabled ? 0 : 1;
    db.getDb().prepare(
        "UPDATE spam_modals SET enabled = ? WHERE language = ? AND category = ?"
    ).run(newState, language, category);

    logic.refreshCache();
    return newState;
}

function updateModalAction(language, category, action) {
    if (!db) return;
    db.getDb().prepare(
        "UPDATE spam_modals SET action = ?, updated_at = CURRENT_TIMESTAMP WHERE language = ? AND category = ?"
    ).run(action, language, category);

    logic.refreshCache();
}

module.exports = {
    init,
    toggleGuildModal,
    listModals,
    getModal,
    upsertModal,
    addPatternsToModal,
    removePatternsFromModal,
    deleteModal,
    toggleModal,
    updateModalAction
};
