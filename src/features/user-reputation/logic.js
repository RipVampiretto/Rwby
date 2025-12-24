const TIER_THRESHOLDS = {
    TIER_0: 0, // Ombra (Shadow)
    TIER_1: 100, // Scudiero (Squire)
    TIER_2: 300, // Guardiano (Guardian)
    TIER_3: 500 // Sentinella (Sentinel)
};

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
        ],
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

async function getUserTier(db, userId, guildId) {
    const flux = await getLocalFlux(db, userId, guildId);
    if (flux >= TIER_THRESHOLDS.TIER_3) return 3;
    if (flux >= TIER_THRESHOLDS.TIER_2) return 2;
    if (flux >= TIER_THRESHOLDS.TIER_1) return 1;
    return 0;
}

async function getLocalFlux(db, userId, guildId) {
    const row = await db.queryOne(
        'SELECT local_flux, last_activity, created_at FROM user_trust_flux WHERE user_id = $1 AND guild_id = $2',
        [userId, guildId]
    );
    return row?.local_flux || 0;
}

async function getGlobalFlux(db, userId) {
    const row = await db.queryOne('SELECT global_flux FROM user_global_flux WHERE user_id = $1', [userId]);
    return row?.global_flux || 0;
}

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

    // Sync global stats
    await syncGlobalUserStats(db, userId);
}

/**
 * Sync user's global stats (flux sum, groups count)
 */
async function syncGlobalUserStats(db, userId) {
    try {
        // Calculate global stats from local trust fluxes
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
        // Log but don't fail the main flow
        console.error(`[reputation] Failed to sync global stats for ${userId}: ${e.message}`);
    }
}

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
