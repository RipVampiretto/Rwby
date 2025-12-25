/**
 * @fileoverview Sistema di feature flags
 * @module utils/feature-flags
 *
 * @description
 * Controlla quali moduli vengono caricati all'avvio del bot.
 * Permette di disabilitare moduli specifici senza modificare il codice.
 *
 * @requires ../middlewares/logger
 */

const logger = require('../middlewares/logger');

/**
 * Flag di abilitazione per ogni modulo.
 * @constant {Object.<string, boolean>}
 */
const flags = {
    // ----- Moduli Core -----
    /** Sistema reputazione utenti (Tier/Flux) */
    userReputation: true,
    /** Blacklist globale (CAS) */
    globalBlacklist: true,
    /** Log azioni */
    actionLog: true,
    /** Coordinamento staff */
    staffCoordination: true,
    /** Amministrazione super admin */
    superAdmin: true,

    // ----- Moduli Rilevamento -----
    /** Filtro parole/frasi vietate */
    wordFilter: true,
    /** Filtro lingua */
    languageFilter: true,
    /** Pattern spam */
    spamPatterns: true,
    /** Filtro link */
    linkFilter: true,
    /** Monitor modifiche messaggi */
    editMonitor: true,
    /** Filtro media (NSFW) */
    mediaFilter: true,
    /** Filtro menzioni esterne */
    mentionFilter: true,

    // ----- Moduli Interattivi -----
    /** Sistema segnalazioni */
    reportSystem: true,
    /** Sistema benvenuto e captcha */
    welcomeSystem: true,
    /** Menu impostazioni */
    settingsMenu: true
};

/**
 * Verifica se un modulo è abilitato.
 *
 * @param {string} featureName - Nome del modulo
 * @returns {boolean} True se abilitato
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
