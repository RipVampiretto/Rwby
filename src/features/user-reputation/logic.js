/**
 * @fileoverview Logica core per il sistema Tier/Flux
 * @module features/user-reputation/logic
 *
 * @description
 * Contiene le definizioni dei Tier, le soglie di Flux e le funzioni
 * per calcolare e modificare la reputazione degli utenti.
 */

/**
 * Soglie di Flux per ogni Tier.
 * @constant {Object.<string, number>}
 */
const TIER_THRESHOLDS = {
    TIER_0: 0,   // Ombra (Shadow)
    TIER_1: 100, // Scudiero (Squire)
    TIER_2: 300, // Guardiano (Guardian)
    TIER_3: 500  // Sentinella (Sentinel)
};

/**
 * Informazioni dettagliate su ogni Tier.
 *
 * @typedef {Object} TierInfo
 * @property {string} id - ID del Tier
 * @property {string} emoji - Emoji rappresentativo
 * @property {string} fluxRange - Range di Flux richiesto
 * @property {string[]} restrictions - Restrizioni applicate
 *
 * @constant {Object.<number, TierInfo>}
 */
const TIER_INFO = {
    0: {
        id: '0',
        emoji: '🌑',
        fluxRange: '0 - 99',
        restrictions: [
            'all_security',
            'links_deleted',
            'forwards_deleted',
            'no_edit',
            'scam_checked',
            'max_ai',
            'strict_rate'
        ]
    },
    1: {
        id: '1',
        emoji: '⚔️',
        fluxRange: '100 - 299',
        restrictions: ['links_flagged', 'ai_active', 'modals_active', 'media_active', 'vote_ban']
    },
    2: {
        id: '2',
        emoji: '🛡️',
        fluxRange: '300 - 499',
        restrictions: ['ai_severe', 'media_active']
    },
    3: {
        id: '3',
        emoji: '👁️',
        fluxRange: '500+',
        restrictions: ['ai_critical']
    }
};

/**
 * Calcola il Tier di un utente in base al suo Flux locale.
 *
 * @param {Object} db - Istanza del database
 * @param {number} userId - ID dell'utente
 * @param {number} guildId - ID del gruppo
 * @returns {Promise<number>} Tier 0-3
 */
async function getUserTier(db, userId, guildId) {
    const flux = await getLocalFlux(db, userId, guildId);
    if (flux >= TIER_THRESHOLDS.TIER_3) return 3;
    if (flux >= TIER_THRESHOLDS.TIER_2) return 2;
    if (flux >= TIER_THRESHOLDS.TIER_1) return 1;
    return 0;
}

/**
 * Ottiene il Flux locale di un utente in un gruppo specifico.
 *
 * @param {Object} db - Istanza del database
 * @param {number} userId - ID dell'utente
 * @param {number} guildId - ID del gruppo
 * @returns {Promise<number>} Flux locale (0 se non trovato)
 */
async function getLocalFlux(db, userId, guildId) {
    const row = await db.queryOne(
        'SELECT local_flux, last_activity, created_at FROM user_trust_flux WHERE user_id = $1 AND guild_id = $2',
        [userId, guildId]
    );
    return row?.local_flux || 0;
}

/**
 * Ottiene il Flux globale di un utente (somma di tutti i gruppi).
 *
 * @param {Object} db - Istanza del database
 * @param {number} userId - ID dell'utente
 * @returns {Promise<number>} Flux globale (0 se non trovato)
 */
async function getGlobalFlux(db, userId) {
    const row = await db.queryOne('SELECT global_flux FROM user_global_flux WHERE user_id = $1', [userId]);
    return row?.global_flux || 0;
}

/**
 * Modifica il Flux locale di un utente.
 * Il Flux è limitato tra -1000 e +1000.
 *
 * @param {Object} db - Istanza del database
 * @param {number} userId - ID dell'utente
 * @param {number} guildId - ID del gruppo
 * @param {number} delta - Variazione da applicare
 * @param {string} reason - Motivo della modifica (per logging)
 * @returns {Promise<void>}
 */
async function modifyFlux(db, userId, guildId, delta, reason) {
    const current = await getLocalFlux(db, userId, guildId);
    const newFlux = Math.max(-1000, Math.min(1000, current + delta));

    await db.query(
        `
        INSERT INTO user_trust_flux (user_id, guild_id, local_flux, last_activity)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT(user_id, guild_id) DO UPDATE SET
            local_flux = $3,
            last_activity = NOW()
    `,
        [userId, guildId, newFlux]
    );

    // Sincronizza le statistiche globali
    await syncGlobalUserStats(db, userId);
}

/**
 * Sincronizza le statistiche globali di un utente.
 * Calcola il Flux totale e il numero di gruppi partecipati.
 *
 * @param {Object} db - Istanza del database
 * @param {number} userId - ID dell'utente
 * @returns {Promise<void>}
 */
async function syncGlobalUserStats(db, userId) {
    try {
        const stats = await db.queryOne(
            `
            SELECT 
                COUNT(DISTINCT guild_id) as groups_participated,
                COALESCE(SUM(local_flux), 0) as total_flux
            FROM user_trust_flux 
            WHERE user_id = $1
            `,
            [userId]
        );

        const groups = parseInt(stats?.groups_participated || 0);
        const flux = parseInt(stats?.total_flux || 0);

        await db.query(
            `
            INSERT INTO user_global_flux (user_id, global_flux, groups_participated, last_sync)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (user_id) DO UPDATE SET
                global_flux = EXCLUDED.global_flux,
                groups_participated = EXCLUDED.groups_participated,
                last_sync = NOW()
            `,
            [userId, flux, groups]
        );
    } catch (e) {
        console.error(`[reputation] Failed to sync global stats for ${userId}: ${e.message}`);
    }
}

/**
 * Ottiene il nome del Tier (per compatibilità legacy).
 *
 * @param {number} tier - Numero del Tier (0-3)
 * @returns {string|undefined} Nome del Tier
 */
function getTierName(tier) {
    return TIER_INFO[tier]?.name || TIER_INFO[3].name;
}

module.exports = {
    TIER_THRESHOLDS,
    TIER_INFO,
    getUserTier,
    getLocalFlux,
    getGlobalFlux,
    modifyFlux,
    syncGlobalUserStats,
    getTierName
};
