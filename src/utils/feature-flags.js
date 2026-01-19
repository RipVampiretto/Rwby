/**
 * @fileoverview Sistema di feature flags con supporto multi-istanza
 * @module utils/feature-flags
 *
 * @description
 * Controlla quali moduli vengono caricati all'avvio del bot.
 * Supporta multiple istanze con feature differenziate.
 * Usa BOT_INSTANCE env var per determinare l'istanza corrente.
 *
 * @requires ../middlewares/logger
 */

const logger = require('../middlewares/logger');

/**
 * Istanza corrente del bot.
 * Default: 'main' se BOT_INSTANCE non è definito.
 * @constant {string}
 */
const CURRENT_INSTANCE = process.env.BOT_INSTANCE || 'rwby';

/**
 * Tutte le istanze conosciute.
 * @constant {string[]}
 */
const ALL_INSTANCES = ['rwby', 'safejoin'];

/**
 * Flag di abilitazione per ogni modulo.
 * - `true` = abilitato su TUTTE le istanze
 * - `false` = disabilitato ovunque
 * - `['rwby']` = abilitato solo su 'rwby'
 * - `['rwby', 'safejoin']` = abilitato su entrambe
 * 
 * @constant {Object.<string, boolean|string[]>}
 */
const flags = {
    // =========================================================================
    // MODULI CORE - Condivisi tra tutte le istanze
    // =========================================================================

    /** Sistema reputazione utenti (Tier/Flux) */
    userReputation: true,

    /** Blacklist globale (CAS + internal) - DEVE essere condiviso */
    globalBlacklist: true,

    /** Log azioni */
    actionLog: true,

    /** Coordinamento staff */
    staffCoordination: true,

    // =========================================================================
    // MODULI ADMIN - Solo istanza principale
    // =========================================================================

    /** Amministrazione super admin - Entrambe per ora */
    superAdmin: true,

    // =========================================================================
    // MODULI RILEVAMENTO - Condivisi
    // =========================================================================

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

    // =========================================================================
    // MODULI INTERATTIVI - Condivisi
    // =========================================================================

    /** Sistema segnalazioni */
    reportSystem: true,

    /** Sistema benvenuto e captcha */
    welcomeSystem: true,

    /** Menu impostazioni */
    settingsMenu: true,

    // =========================================================================
    // MODULI FUTURI - Placeholder per nuove feature
    // =========================================================================

    /** AI Daily Recap - Solo rwby (esempio futuro) */
    // aiDailyRecap: ['rwby'],

    /** Mascotte AI (Risposte automatiche) - Solo rwby */
    aiMascot: ['rwby']
};

/**
 * Ritorna l'istanza corrente del bot.
 * 
 * @returns {string} Nome istanza (es. 'main', 'secondary')
 */
function getInstance() {
    return CURRENT_INSTANCE;
}

/**
 * Ritorna tutte le istanze conosciute.
 * 
 * @returns {string[]} Array di nomi istanze
 */
function getAllInstances() {
    return [...ALL_INSTANCES];
}

/**
 * Verifica se un modulo è abilitato per l'istanza corrente.
 *
 * @param {string} featureName - Nome del modulo
 * @returns {boolean} True se abilitato per questa istanza
 */
function isEnabled(featureName) {
    const flag = flags[featureName];

    // Feature sconosciuta
    if (flag === undefined) {
        logger.warn(`[feature-flags] Unknown module: ${featureName}`);
        return false;
    }

    // Boolean: abilitato/disabilitato globalmente
    if (typeof flag === 'boolean') {
        return flag;
    }

    // Array: lista di istanze dove è abilitato
    if (Array.isArray(flag)) {
        return flag.includes(CURRENT_INSTANCE);
    }

    // Fallback
    logger.warn(`[feature-flags] Invalid flag format for ${featureName}: ${typeof flag}`);
    return false;
}

/**
 * Verifica se un modulo è abilitato per una specifica istanza.
 *
 * @param {string} featureName - Nome del modulo
 * @param {string} instanceName - Nome dell'istanza
 * @returns {boolean} True se abilitato per quella istanza
 */
function isEnabledForInstance(featureName, instanceName) {
    const flag = flags[featureName];

    if (flag === undefined) {
        return false;
    }

    if (typeof flag === 'boolean') {
        return flag;
    }

    if (Array.isArray(flag)) {
        return flag.includes(instanceName);
    }

    return false;
}

// Log istanza all'import del modulo
logger.info(`[feature-flags] Current instance: ${CURRENT_INSTANCE}`);

module.exports = {
    isEnabled,
    isEnabledForInstance,
    getInstance,
    getAllInstances,
    flags,
    CURRENT_INSTANCE
};
