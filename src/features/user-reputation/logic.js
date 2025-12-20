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

function getUserTier(db, userId, guildId) {
    const flux = getLocalFlux(db, userId, guildId);
    if (flux >= TIER_THRESHOLDS.TIER_3) return 3;
    if (flux >= TIER_THRESHOLDS.TIER_2) return 2;
    if (flux >= TIER_THRESHOLDS.TIER_1) return 1;
    return 0;
}

function getLocalFlux(db, userId, guildId) {
    const row = db.getDb().prepare(
        'SELECT local_flux, last_activity, created_at FROM user_trust_flux WHERE user_id = ? AND guild_id = ?'
    ).get(userId, guildId);

    return row?.local_flux || 0;
}

function getGlobalFlux(db, userId) {
    const row = db.getDb().prepare(
        'SELECT global_flux FROM user_global_flux WHERE user_id = ?'
    ).get(userId);
    return row?.global_flux || 0;
}

function modifyFlux(db, userId, guildId, delta, reason) {
    const current = getLocalFlux(db, userId, guildId);
    const newFlux = Math.max(-1000, Math.min(1000, current + delta));

    db.getDb().prepare(`
        INSERT INTO user_trust_flux (user_id, guild_id, local_flux, last_activity)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, guild_id) DO UPDATE SET
            local_flux = ?,
            last_activity = CURRENT_TIMESTAMP
    `).run(userId, guildId, newFlux, newFlux);
}

function getTierName(tier) {
    return TIER_INFO[tier]?.name || TIER_INFO[3].name; // Note: 'name' is in i18n, but this access just checks object existence or fallback
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
