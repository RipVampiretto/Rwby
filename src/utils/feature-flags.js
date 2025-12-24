/**
 * FEATURE FLAGS SYSTEM
 * Control which modules are loaded at startup.
 */

const logger = require('../middlewares/logger');

const flags = {
    // Core Modules
    userReputation: true,
    globalBlacklist: true,
    actionLog: true,
    staffCoordination: true,
    superAdmin: true,

    // Detection Modules
    wordFilter: true,
    languageFilter: true,
    spamPatterns: true,
    linkFilter: true,
    editMonitor: true,
    mediaFilter: true,

    // Community / Interactive
    reportSystem: true,
    welcomeSystem: true,
    settingsMenu: true
};

/**
 * Check if a feature is enabled
 * @param {string} featureName
 * @returns {boolean}
 */
function isEnabled(featureName) {
    const enabled = flags[featureName];
    if (enabled === undefined) {
        logger.warn(`[feature-flags] Unknown module: ${featureName}`);
        return false;
    }
    return enabled;
}

module.exports = {
    isEnabled,
    flags
};
