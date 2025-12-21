const logic = require('./logic');
const logger = require('../../middlewares/logger');

let db = null;

function init(database) {
    db = database;
}

// ============================================================================
// GUILD MODAL OVERRIDES
// ============================================================================

async function toggleGuildModal(guildId, modalId) {
    if (!db) return null;
    try {
        const current = await logic.isModalEnabledForGuild(guildId, modalId);
        const newState = !current;

        await db.query(`
            INSERT INTO guild_modal_overrides (guild_id, modal_id, enabled)
            VALUES ($1, $2, $3)
            ON CONFLICT(guild_id, modal_id) DO UPDATE SET enabled = $3
        `, [guildId, modalId, newState]);

        return newState;
    } catch (e) {
        logger.error(`[modal-patterns] Failed to toggle guild modal: ${e.message}`);
        return null;
    }
}

// ============================================================================
// SUPERADMIN MODAL MANAGEMENT
// ============================================================================

async function listModals(language = null) {
    if (!db) return [];
    if (language) {
        return await db.queryAll(
            "SELECT * FROM spam_modals WHERE language = $1 ORDER BY category",
            [language]
        );
    }
    return await db.queryAll("SELECT * FROM spam_modals ORDER BY language, category");
}

async function getModal(language, category) {
    if (!db) return null;
    return await db.queryOne(
        "SELECT * FROM spam_modals WHERE language = $1 AND category = $2",
        [language, category]
    );
}

async function upsertModal(language, category, patterns, action = 'report_only', threshold = 0.6, createdBy = null) {
    if (!db) return;
    const patternsJson = JSON.stringify(patterns);

    await db.query(`
        INSERT INTO spam_modals (language, category, patterns, action, similarity_threshold, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT(language, category) DO UPDATE SET
            patterns = $3,
            action = $4,
            similarity_threshold = $5,
            updated_at = NOW()
    `, [language, category, patternsJson, action, threshold, createdBy]);

    await logic.refreshCache();
}

async function addPatternsToModal(language, category, newPatterns) {
    const modal = await getModal(language, category);
    if (!modal) return false;

    const existing = logic.safeJsonParse(modal.patterns, []);
    const combined = [...new Set([...existing, ...newPatterns])];

    await db.query(
        "UPDATE spam_modals SET patterns = $1, updated_at = NOW() WHERE language = $2 AND category = $3",
        [JSON.stringify(combined), language, category]
    );

    await logic.refreshCache();
    return true;
}

async function removePatternsFromModal(language, category, patternsToRemove) {
    const modal = await getModal(language, category);
    if (!modal) return false;

    const existing = logic.safeJsonParse(modal.patterns, []);
    const filtered = existing.filter(p => !patternsToRemove.includes(p));

    await db.query(
        "UPDATE spam_modals SET patterns = $1, updated_at = NOW() WHERE language = $2 AND category = $3",
        [JSON.stringify(filtered), language, category]
    );

    await logic.refreshCache();
    return true;
}

async function deleteModal(language, category) {
    if (!db) return false;
    const result = await db.query(
        "DELETE FROM spam_modals WHERE language = $1 AND category = $2",
        [language, category]
    );

    await logic.refreshCache();
    return result.rowCount > 0;
}

async function toggleModal(language, category) {
    if (!db) return null;
    const modal = await getModal(language, category);
    if (!modal) return null;

    const newState = !modal.enabled;
    await db.query(
        "UPDATE spam_modals SET enabled = $1 WHERE language = $2 AND category = $3",
        [newState, language, category]
    );

    await logic.refreshCache();
    return newState;
}

async function updateModalAction(language, category, action) {
    if (!db) return;
    await db.query(
        "UPDATE spam_modals SET action = $1, updated_at = NOW() WHERE language = $2 AND category = $3",
        [action, language, category]
    );

    await logic.refreshCache();
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
