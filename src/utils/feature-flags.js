/**
 * FEATURE FLAGS SYSTEM
 * Control which modules are loaded at startup.
 * Useful for debugging or disabling problematic modules without code changes.
 */

const logger = require('../middlewares/logger');

const flags = {
    // Core Modules
    userReputation: true,
    casBan: true,
    adminLogger: true,
    staffCoordination: true,
    superAdmin: true,
    intelNetwork: false, // DISABLED BY DEFAULT

    // Detection Modules
    antiSpam: false, // DISABLED BY DEFAULT
    keywordMonitor: true,
    languageMonitor: true,
    modalPatterns: true,
    linkMonitor: true,
    aiModeration: true,
    antiEditAbuse: true,
    intelligentProfiler: false, // DISABLED BY DEFAULT
    nsfwMonitor: true,
    visualImmuneSystem: false, // DISABLED BY DEFAULT

    // Community / Interactive
    voteBan: true,
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
    if (!enabled) {
        logger.debug(`[feature-flags] Skipping disabled module: ${featureName}`);
    }
    return enabled;
}

module.exports = {
    isEnabled,
    flags
};
