const TIER_THRESHOLDS = {
    TIER_0: 0,    // Ombra (Shadow)
    TIER_1: 100,  // Scudiero (Squire)
    TIER_2: 300,  // Guardiano (Guardian)
    TIER_3: 500   // Sentinella (Sentinel)
};

const TIER_INFO = {
    0: {
        id: "0",
        emoji: "🌑",
        fluxRange: "0 - 99",
        restrictions: [
            "all_security", "links_deleted", "forwards_deleted", "no_edit",
            "scam_checked", "max_ai", "strict_rate"
        ],
        bypasses: []
    },
    1: {
        id: "1",
        emoji: "⚔️",
        fluxRange: "100 - 299",
        restrictions: [
            "links_flagged", "ai_active", "modals_active", "nsfw_active", "vote_ban"
        ],
        bypasses: [
            "profiler_bypass", "edit_allowed", "lang_bypass", "forwards_allowed"
        ]
    },
    2: {
        id: "2",
        emoji: "🛡️",
        fluxRange: "300 - 499",
        restrictions: [
            "ai_severe", "nsfw_active"
        ],
        bypasses: [
            "spam_bypass", "keyword_bypass", "lang_bypass", "link_bypass",
            "modal_bypass", "antiedit_bypass", "profiler_disabled"
        ]
    },
    3: {
        id: "3",
        emoji: "👁️",
        fluxRange: "500+",
        restrictions: [
            "ai_critical"
        ],
        bypasses: [
            "all_bypass", "nsfw_bypass", "visual_bypass"
        ]
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
    const row = await db.queryOne(
        'SELECT global_flux FROM user_global_flux WHERE user_id = $1',
        [userId]
    );
    return row?.global_flux || 0;
}

async function modifyFlux(db, userId, guildId, delta, reason) {
    const current = await getLocalFlux(db, userId, guildId);
    const newFlux = Math.max(-1000, Math.min(1000, current + delta));

    await db.query(`
        INSERT INTO user_trust_flux (user_id, guild_id, local_flux, last_activity)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT(user_id, guild_id) DO UPDATE SET
            local_flux = $3,
            last_activity = NOW()
    `, [userId, guildId, newFlux]);
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
    getTierName
};
