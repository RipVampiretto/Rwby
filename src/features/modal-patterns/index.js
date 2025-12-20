// ============================================================================
// MODAL PATTERNS - Language/Category Based Spam Detection
// ============================================================================
// SCOPO: Sistema di pattern globali organizzati per lingua e categoria.
// I SuperAdmin gestiscono i modali, che vengono applicati automaticamente
// a tutti i gruppi in base alle lingue configurate.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. CONCETTO
// ----------------------------------------------------------------------------
//
// MODALI = Pattern di spam organizzati per:
// ├── Lingua: "en", "it", "ru", "*" (wildcard per tutte)
// └── Categoria: "scam", "crypto", "sex", etc.
//
// Ogni gruppo carica automaticamente i modali delle sue lingue permesse.
// Similarity matching con Jaccard per fuzzy detection.

// ----------------------------------------------------------------------------
// 2. DATA MODEL
// ----------------------------------------------------------------------------
//
// TABELLA: spam_modals
// ├── language: TEXT ("en", "it", "*")
// ├── category: TEXT ("scam", "crypto", "sex")
// ├── patterns: TEXT (JSON Array di stringhe)
// ├── action: TEXT ("delete", "ban", "report_only")
// ├── similarity_threshold: REAL (0.0 - 1.0, default 0.6)
// └── enabled: INTEGER (0/1)
//
// TABELLA: guild_config (campi modal)
// ├── modal_enabled: INTEGER (0/1, DEFAULT 1)
// ├── modal_action: TEXT (override default)
// ├── modal_sync_global: INTEGER (DEFAULT 1)
// └── modal_tier_bypass: INTEGER (DEFAULT 2)

// ============================================================================
// MODULE IMPLEMENTATION
// ============================================================================

let db = null;
let _botInstance = null;

const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');
const { safeDelete, safeBan, isAdmin, isFromSettingsMenu } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');

// Cache for loaded modals (refresh every 5 minutes)
let modalCache = [];
let modalCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Middleware: check messages against modals
    bot.on("message:text", async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip admins
        if (await isAdmin(ctx, 'modal-patterns')) return next();

        // Config check
        const config = db.getGuildConfig(ctx.chat.id);
        if (!config.modal_enabled) return next();

        // Tier bypass (-1 = OFF, no bypass)
        const tierBypass = config.modal_tier_bypass ?? 2;
        if (tierBypass !== -1 && ctx.userTier !== undefined && ctx.userTier >= tierBypass) return next();

        // Check against modals
        const match = await checkMessageAgainstModals(ctx, config);
        if (match) {
            await executeAction(ctx, match.action, match.category, match.pattern, match.similarity);
        }

        await next();
    });

    // Command: /modalconfig (group admins)
    bot.command("modalconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        if (!await isAdmin(ctx, 'modal-patterns')) return;

        await sendConfigUI(ctx);
    });

    // UI Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("mdl_")) return next();

        const config = db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === "mdl_close") return ctx.deleteMessage();

        if (data === "mdl_toggle") {
            db.updateGuildConfig(ctx.chat.id, { modal_enabled: config.modal_enabled ? 0 : 1 });
        } else if (data === "mdl_act") {
            const acts = ['report_only', 'delete', 'ban'];
            let cur = config.modal_action || 'report_only';
            if (!acts.includes(cur)) cur = 'report_only';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 3];
            db.updateGuildConfig(ctx.chat.id, { modal_action: nextAct });
        } else if (data === "mdl_tier") {
            // Cycle through 0, 1, 2, 3, -1 (OFF)
            const tiers = [0, 1, 2, 3, -1];
            let cur = config.modal_tier_bypass ?? 2;
            const idx = tiers.indexOf(cur);
            const nextTier = tiers[(idx + 1) % tiers.length];
            db.updateGuildConfig(ctx.chat.id, { modal_tier_bypass: nextTier });
        } else if (data === "mdl_list") {
            // Show modal list sub-menu
            await sendModalListUI(ctx, true, fromSettings);
            return;
        } else if (data === "mdl_back") {
            // Return to main config
            await sendConfigUI(ctx, true, fromSettings);
            return;
        } else if (data.startsWith("mdl_tog:")) {
            // Toggle specific modal for this guild
            const modalId = parseInt(data.split(':')[1]);
            toggleGuildModal(ctx.chat.id, modalId);
            // Stay on modal list
            await sendModalListUI(ctx, true, fromSettings);
            return;
        }

        await sendConfigUI(ctx, true, fromSettings);
    });

    logger.info('[modal-patterns] Module registered');
}

// ============================================================================
// PATTERN MATCHING
// ============================================================================

/**
 * Check message against loaded modals for the group's languages
 */
async function checkMessageAgainstModals(ctx, config) {
    const text = (ctx.message.text || '').toLowerCase().trim();
    if (text.length < 10) return null; // Skip very short messages

    // Get group's allowed languages
    let allowedLangs = ['en']; // Default
    try {
        const parsed = JSON.parse(config.allowed_languages || '[]');
        if (parsed.length > 0) allowedLangs = parsed;
    } catch (e) { }

    // Load modals (cached) and filter by guild overrides
    const modals = getModalsForLanguages(allowedLangs);
    const guildId = ctx.chat.id;

    for (const modal of modals) {
        if (!modal.enabled) continue;

        // Check guild override
        if (!isModalEnabledForGuild(guildId, modal.id)) continue;

        const patterns = safeJsonParse(modal.patterns, []);
        for (const pattern of patterns) {
            const similarity = jaccardSimilarity(text, pattern.toLowerCase());

            if (similarity >= (modal.similarity_threshold || 0.6)) {
                return {
                    modal: modal,
                    category: modal.category,
                    action: config.modal_action || modal.action || 'report_only',
                    pattern: pattern,
                    similarity: similarity
                };
            }
        }
    }

    return null;
}

/**
 * Jaccard Similarity - Token based comparison
 * Returns value between 0 (no match) and 1 (exact match)
 */
function jaccardSimilarity(text1, text2) {
    const tokens1 = new Set(text1.split(/\s+/).filter(t => t.length > 2));
    const tokens2 = new Set(text2.split(/\s+/).filter(t => t.length > 2));

    if (tokens1.size === 0 || tokens2.size === 0) return 0;

    const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
    const union = new Set([...tokens1, ...tokens2]);

    return intersection.size / union.size;
}

/**
 * Load modals for specified languages (with caching)
 */
function getModalsForLanguages(languages) {
    // Check cache
    if (Date.now() - modalCacheTime < CACHE_TTL && modalCache.length > 0) {
        return modalCache.filter(m =>
            languages.includes(m.language) || m.language === '*'
        );
    }

    // Reload from DB
    try {
        modalCache = db.getDb().prepare(
            "SELECT * FROM spam_modals WHERE enabled = 1"
        ).all();
        modalCacheTime = Date.now();
    } catch (e) {
        logger.error(`[modal-patterns] Failed to load modals: ${e.message}`);
        modalCache = [];
    }

    return modalCache.filter(m =>
        languages.includes(m.language) || m.language === '*'
    );
}

/**
 * Force refresh modal cache
 */
function refreshCache() {
    modalCacheTime = 0;
    getModalsForLanguages(['*']); // Force reload
}

function safeJsonParse(str, defaultVal) {
    try { return JSON.parse(str); } catch (e) { return defaultVal; }
}

// ============================================================================
// GUILD MODAL OVERRIDES
// ============================================================================

/**
 * Check if a modal is enabled for a specific guild
 * Returns true if no override exists (default enabled) or override is enabled
 */
function isModalEnabledForGuild(guildId, modalId) {
    try {
        const override = db.getDb().prepare(
            "SELECT enabled FROM guild_modal_overrides WHERE guild_id = ? AND modal_id = ?"
        ).get(guildId, modalId);

        // No override = enabled by default
        if (!override) return true;
        return override.enabled === 1;
    } catch (e) {
        return true; // Default enabled if error
    }
}

/**
 * Toggle modal enabled state for a specific guild
 */
function toggleGuildModal(guildId, modalId) {
    try {
        const current = isModalEnabledForGuild(guildId, modalId);
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
// ACTION EXECUTION
// ============================================================================

async function executeAction(ctx, action, category, pattern, similarity) {
    const user = ctx.from;
    const text = ctx.message.text || '';

    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'modal_detect',
        targetUser: user,
        executorAdmin: null,
        reason: `Modal: ${category} (${Math.round(similarity * 100)}% match)`,
        isGlobal: (action === 'ban')
    };

    logger.info(`[modal-patterns] Match: ${category} | User: ${user.id} | Sim: ${Math.round(similarity * 100)}% | Action: ${action}`);

    if (action === 'delete') {
        await safeDelete(ctx, 'modal-patterns');
    }
    else if (action === 'ban') {
        await safeDelete(ctx, 'modal-patterns');
        const banned = await safeBan(ctx, user.id, 'modal-patterns');

        if (banned) {
            userReputation.modifyFlux(user.id, ctx.chat.id, -50, 'modal_ban');

            if (superAdmin.forwardBanToParliament) {
                superAdmin.forwardBanToParliament({
                    user: user,
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: `Modal Ban: ${category} pattern`,
                    evidence: text.substring(0, 300),
                    flux: userReputation.getLocalFlux(user.id, ctx.chat.id)
                });
            }

            logParams.eventType = 'ban';
            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
        }
    }
    else if (action === 'report_only') {
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Modal Pattern',
            user: user,
            reason: `Category: ${category}\nPattern: "${pattern}"\nSimilarity: ${Math.round(similarity * 100)}%`,
            messageId: ctx.message.message_id,
            content: text
        });
    }
}

// ============================================================================
// CONFIGURATION UI
// ============================================================================

async function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.modal_enabled ? '✅ ON' : '❌ OFF';
    const action = (config.modal_action || 'report_only').toUpperCase().replace(/_/g, ' ');
    const tierBypass = config.modal_tier_bypass ?? 2;

    // Count active modals for this group's languages
    let allowedLangs = ['it', 'en'];
    try {
        const parsed = JSON.parse(config.allowed_languages || '[]');
        if (parsed.length > 0) allowedLangs = parsed;
    } catch (e) { }

    const modals = getModalsForLanguages(allowedLangs);
    const activeCount = modals.filter(m => m.enabled).length;

    const text = `📋 **MODAL PATTERNS**\n\n` +
        `Sistema di rilevamento spam basato su pattern globali.\n` +
        `I pattern sono organizzati per lingua e categoria.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Pattern caricati per le tue lingue: ${activeCount}\n` +
        `• Lingue gruppo: ${allowedLangs.join(', ').toUpperCase()}\n` +
        `• Solo SuperAdmin possono gestire i pattern\n\n` +
        `Stato: ${enabled}\n` +
        `Azione: ${action}\n` +
        `Bypass Tier: ${tierBypass}+`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "mdl_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `📋 Modals: ${enabled}`, callback_data: "mdl_toggle" }],
            [{ text: `👮 Azione: ${action}`, callback_data: "mdl_act" }],
            [{ text: `🎖️ Bypass Tier: ${tierBypass === -1 ? 'OFF' : tierBypass + '+'}`, callback_data: "mdl_tier" }],
            [{ text: `📝 Gestisci Modali (${activeCount})`, callback_data: "mdl_list" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        try { await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' }); } catch (e) { }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

/**
 * Send modal list UI for per-group toggle
 */
async function sendModalListUI(ctx, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const guildId = ctx.chat.id;

    // Get group's allowed languages
    let allowedLangs = ['it', 'en'];
    try {
        const parsed = JSON.parse(config.allowed_languages || '[]');
        if (parsed.length > 0) allowedLangs = parsed;
    } catch (e) { }

    const modals = getModalsForLanguages(allowedLangs);

    if (modals.length === 0) {
        const text = "📋 MODALI DISPONIBILI\n\nNessun modal disponibile per le tue lingue.\nI SuperAdmin devono crearli con /gmodal add";
        const keyboard = {
            inline_keyboard: [
                [{ text: "🔙 Indietro", callback_data: "mdl_back" }]
            ]
        };
        if (isEdit) {
            try { await ctx.editMessageText(text, { reply_markup: keyboard }); } catch (e) { }
        } else {
            await ctx.reply(text, { reply_markup: keyboard });
        }
        return;
    }

    let text = "📋 MODALI DISPONIBILI\n\nAttiva/disattiva i modali per questo gruppo:\n";

    // Build toggle buttons for each modal
    const buttons = modals.map(m => {
        const isEnabled = isModalEnabledForGuild(guildId, m.id);
        const patterns = safeJsonParse(m.patterns, []);
        const icon = isEnabled ? '✅' : '❌';
        return {
            text: `${icon} ${m.language.toUpperCase()}/${m.category} (${patterns.length})`,
            callback_data: `mdl_tog:${m.id}`
        };
    });

    // Split into rows of 2
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) {
        rows.push(buttons.slice(i, i + 2));
    }
    rows.push([{ text: "🔙 Indietro", callback_data: "mdl_back" }]);

    const keyboard = { inline_keyboard: rows };

    if (isEdit) {
        try { await ctx.editMessageText(text, { reply_markup: keyboard }); } catch (e) { }
    } else {
        await ctx.reply(text, { reply_markup: keyboard });
    }
}

// ============================================================================
// SUPERADMIN MODAL MANAGEMENT (exported for use by super-admin module)
// ============================================================================

/**
 * List all modals, optionally filtered by language
 */
function listModals(language = null) {
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

/**
 * Get a specific modal by language and category
 */
function getModal(language, category) {
    return db.getDb().prepare(
        "SELECT * FROM spam_modals WHERE language = ? AND category = ?"
    ).get(language, category);
}

/**
 * Create or update a modal
 */
function upsertModal(language, category, patterns, action = 'report_only', threshold = 0.6, createdBy = null) {
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

    refreshCache();
}

/**
 * Add patterns to an existing modal
 */
function addPatternsToModal(language, category, newPatterns) {
    const modal = getModal(language, category);
    if (!modal) return false;

    const existing = safeJsonParse(modal.patterns, []);
    const combined = [...new Set([...existing, ...newPatterns])];

    db.getDb().prepare(
        "UPDATE spam_modals SET patterns = ?, updated_at = CURRENT_TIMESTAMP WHERE language = ? AND category = ?"
    ).run(JSON.stringify(combined), language, category);

    refreshCache();
    return true;
}

/**
 * Remove patterns from a modal
 */
function removePatternsFromModal(language, category, patternsToRemove) {
    const modal = getModal(language, category);
    if (!modal) return false;

    const existing = safeJsonParse(modal.patterns, []);
    const filtered = existing.filter(p => !patternsToRemove.includes(p));

    db.getDb().prepare(
        "UPDATE spam_modals SET patterns = ?, updated_at = CURRENT_TIMESTAMP WHERE language = ? AND category = ?"
    ).run(JSON.stringify(filtered), language, category);

    refreshCache();
    return true;
}

/**
 * Delete a modal
 */
function deleteModal(language, category) {
    const result = db.getDb().prepare(
        "DELETE FROM spam_modals WHERE language = ? AND category = ?"
    ).run(language, category);

    refreshCache();
    return result.changes > 0;
}

/**
 * Toggle modal enabled state
 */
function toggleModal(language, category) {
    const modal = getModal(language, category);
    if (!modal) return null;

    const newState = modal.enabled ? 0 : 1;
    db.getDb().prepare(
        "UPDATE spam_modals SET enabled = ? WHERE language = ? AND category = ?"
    ).run(newState, language, category);

    refreshCache();
    return newState;
}

/**
 * Update modal action
 */
function updateModalAction(language, category, action) {
    db.getDb().prepare(
        "UPDATE spam_modals SET action = ?, updated_at = CURRENT_TIMESTAMP WHERE language = ? AND category = ?"
    ).run(action, language, category);

    refreshCache();
}

module.exports = {
    register,
    sendConfigUI,
    // SuperAdmin API
    listModals,
    getModal,
    upsertModal,
    addPatternsToModal,
    removePatternsFromModal,
    deleteModal,
    toggleModal,
    updateModalAction,
    refreshCache
};
