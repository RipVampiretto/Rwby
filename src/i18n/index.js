const fs = require('fs');
const path = require('path');
const logger = require('../middlewares/logger');

// ============================================================================
// I18N MODULE - Multi-language support for UI
// ============================================================================

// Cache for loaded locales
const localesCache = {};

// Default language
const DEFAULT_LANG = 'en';

// Available languages
const AVAILABLE_LANGUAGES = {
    'en': '🇬🇧 English',
    'it': '🇮🇹 Italiano'
};

let db = null;

/**
 * Initialize i18n module
 */
function init(database) {
    db = database;

    // Pre-load all locale files
    const localesDir = path.join(__dirname, 'locales');

    for (const langCode of Object.keys(AVAILABLE_LANGUAGES)) {
        const filePath = path.join(localesDir, `${langCode}.json`);
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                localesCache[langCode] = JSON.parse(content);
                logger.info(`[i18n] Loaded locale: ${langCode}`);
            }
        } catch (e) {
            logger.error(`[i18n] Failed to load locale ${langCode}: ${e.message}`);
        }
    }

    // Ensure default language is loaded
    if (!localesCache[DEFAULT_LANG]) {
        logger.error(`[i18n] Default language ${DEFAULT_LANG} not loaded!`);
        localesCache[DEFAULT_LANG] = {};
    }

    logger.info(`[i18n] Initialized with ${Object.keys(localesCache).length} languages`);
}

/**
 * Get translation for a key
 * @param {number} guildId - Guild ID to get language for
 * @param {string} key - Translation key (dot notation: "settings.title")
 * @param {object} params - Optional parameters for interpolation
 * @returns {string} Translated string or key if not found
 */
function t(guildId, key, params = {}) {
    const lang = getLanguage(guildId);
    const locale = localesCache[lang] || localesCache[DEFAULT_LANG];

    // Navigate nested keys (e.g., "settings.main.title")
    let value = key.split('.').reduce((obj, k) => obj?.[k], locale);

    // Fallback to default language if not found
    if (value === undefined && lang !== DEFAULT_LANG) {
        value = key.split('.').reduce((obj, k) => obj?.[k], localesCache[DEFAULT_LANG]);
    }

    // Return key if still not found
    if (value === undefined) {
        logger.warn(`[i18n] Missing translation: ${key} (${lang})`);
        return key;
    }

    // Interpolate parameters: {name} -> params.name
    if (typeof value === 'string' && Object.keys(params).length > 0) {
        for (const [paramKey, paramValue] of Object.entries(params)) {
            value = value.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), paramValue);
        }
    }

    return value;
}

/**
 * Get current language for a guild
 * @param {number} guildId - Guild ID
 * @returns {string} Language code
 */
function getLanguage(guildId) {
    if (!db || !guildId) return DEFAULT_LANG;

    try {
        const config = db.getGuildConfig(guildId);
        return config?.ui_language || DEFAULT_LANG;
    } catch (e) {
        return DEFAULT_LANG;
    }
}

/**
 * Set language for a guild
 * @param {number} guildId - Guild ID
 * @param {string} langCode - Language code
 * @returns {boolean} Success
 */
function setLanguage(guildId, langCode) {
    if (!AVAILABLE_LANGUAGES[langCode]) {
        logger.warn(`[i18n] Invalid language code: ${langCode}`);
        return false;
    }

    try {
        db.updateGuildConfig(guildId, { ui_language: langCode });
        logger.info(`[i18n] Set language for guild ${guildId}: ${langCode}`);
        return true;
    } catch (e) {
        logger.error(`[i18n] Failed to set language: ${e.message}`);
        return false;
    }
}

/**
 * Get available languages
 * @returns {object} Map of langCode -> display name
 */
function getAvailableLanguages() {
    return AVAILABLE_LANGUAGES;
}

/**
 * Get default language code
 * @returns {string} Default language code
 */
function getDefaultLanguage() {
    return DEFAULT_LANG;
}

/**
 * Middleware to attach i18n functions to context
 */
function middleware() {
    return async (ctx, next) => {
        // Attach translation function to context
        ctx.t = (key, params) => {
            const guildId = ctx.chat?.id;
            return t(guildId, key, params);
        };

        // Attach other helpers
        ctx.i18n = {
            getLanguage: () => getLanguage(ctx.chat?.id),
            setLanguage: (lang) => setLanguage(ctx.chat?.id, lang),
            available: AVAILABLE_LANGUAGES
        };

        await next();
    };
}

/**
 * Format action value to localized UI text
 * Converts: report_only -> "Segnala", delete -> "Elimina", ban -> "Banna"
 * @param {number} guildId - Guild ID for language
 * @param {string} action - Action value (report_only, delete, ban)
 * @returns {string} Localized action text
 */
function formatAction(guildId, action) {
    const actionKey = (action || 'report_only').toLowerCase().replace(/_/g, '');
    const actionMap = {
        'reportonly': 'common.report_only',
        'report_only': 'common.report_only',
        'delete': 'common.delete',
        'ban': 'common.ban'
    };

    const key = actionMap[actionKey] || actionMap[(action || '').toLowerCase()];
    if (key) {
        return t(guildId, key);
    }
    return action || 'Report';
}

module.exports = {
    init,
    t,
    getLanguage,
    setLanguage,
    getAvailableLanguages,
    getDefaultLanguage,
    middleware,
    formatAction
};

