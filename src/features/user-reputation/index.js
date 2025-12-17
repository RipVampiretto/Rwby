// ============================================================================
// TODO: IMPLEMENTATION PLAN - USER REPUTATION ("TrustFlux")
// ============================================================================
// SCOPO: Sistema reputazione organico basato su attività.
// TrustFlux = punteggio dinamico con scope locale e globale.
// Determina Tier utente che influenza bypass moduli moderazione.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: user_trust_flux
// ├── user_id, guild_id: INTEGER (PRIMARY KEY combo)
// ├── local_flux: INTEGER (DEFAULT 0, range -1000 to +1000)
// ├── created_at: TEXT
// └── last_activity: TEXT
//
// TABELLA: user_global_flux
// ├── user_id: INTEGER PRIMARY KEY
// ├── global_flux: INTEGER (DEFAULT 0)
// ├── groups_participated: INTEGER
// ├── total_violations: INTEGER
// └── last_sync: TEXT

// ----------------------------------------------------------------------------
// 2. TIER SYSTEM - Classificazione
// ----------------------------------------------------------------------------
//
// TIER 0 - "Novizio" (local_flux < 100):
// └── Massime restrizioni, profiler attivo
//
// TIER 1 - "Membro" (local_flux 100-299):
// └── Alcune restrizioni rimosse
//
// TIER 2 - "Residente" (local_flux 300-499):
// └── Bypass maggior parte filtri
//
// TIER 3+ - "Veterano" (local_flux >= 500):
// └── Bypass quasi tutto, solo AI per gravi

// ----------------------------------------------------------------------------
// 3. FLUX CALCULATION
// ----------------------------------------------------------------------------
//
// GUADAGNO:
// ├── Messaggio normale: +1 (max 10/ora)
// ├── Reazione ricevuta: +2
// ├── Tempo passivo: +1/giorno
//
// PERDITA:
// ├── Messaggio eliminato: -10
// ├── Ban: -100 (e propagazione globale)

// ----------------------------------------------------------------------------
// 4. USER COMMANDS
// ----------------------------------------------------------------------------
//
// /myflux:
// ┌────────────────────────────────────────────┐
// │ 📊 **IL TUO TRUSTFLUX**                    │
// │ 🏠 Locale: 245 | 🌍 Globale: 180          │
// │ 🏷️ Tier: 1 - Membro                      │
// │ ████████░░ 245/300 per Tier 2             │
// └────────────────────────────────────────────┘

// ----------------------------------------------------------------------------
// 5. API ESPOSTA
// ----------------------------------------------------------------------------
//
// getUserTier(userId, guildId) → Number (0-3+)
// getLocalFlux(userId, guildId) → Number
// getGlobalFlux(userId) → Number
// modifyFlux(userId, guildId, delta, reason) → void

// ============================================================================
// MODULE EXPORTS
// ============================================================================

const TIER_THRESHOLDS = {
    TIER_0: 0,    // Novizio
    TIER_1: 100,  // Membro
    TIER_2: 300,  // Residente
    TIER_3: 500   // Veterano
};

let db = null;

function register(bot, database) {
    db = database;

    // Middleware: attach user tier to context
    bot.use(async (ctx, next) => {
        if (ctx.from && ctx.chat && ctx.chat.type !== 'private') {
            ctx.userTier = getUserTier(ctx.from.id, ctx.chat.id);
            ctx.userFlux = getLocalFlux(ctx.from.id, ctx.chat.id);
        }
        await next();
    });

    // Command: /myflux
    bot.command("myflux", async (ctx) => {
        if (!ctx.from || ctx.chat.type === 'private') return;

        const userId = ctx.from.id;
        const guildId = ctx.chat.id;
        const localFlux = getLocalFlux(userId, guildId);
        const globalFlux = getGlobalFlux(userId);
        const tier = getUserTier(userId, guildId);
        const tierName = getTierName(tier);

        const nextTierFlux = tier < 3 ? TIER_THRESHOLDS[`TIER_${tier + 1}`] : null;
        const progress = nextTierFlux ? Math.min(10, Math.floor((localFlux / nextTierFlux) * 10)) : 10;
        const progressBar = '█'.repeat(progress) + '░'.repeat(10 - progress);

        let text = `📊 **IL TUO TRUSTFLUX**\n\n`;
        text += `🏠 Locale: ${localFlux} | 🌍 Globale: ${globalFlux}\n`;
        text += `🏷️ Tier: ${tier} - ${tierName}\n\n`;
        text += `${progressBar} ${localFlux}/${nextTierFlux || '∞'}`;

        await ctx.reply(text, { parse_mode: "Markdown" });
    });
}

function getUserTier(userId, guildId) {
    const flux = getLocalFlux(userId, guildId);
    if (flux >= TIER_THRESHOLDS.TIER_3) return 3;
    if (flux >= TIER_THRESHOLDS.TIER_2) return 2;
    if (flux >= TIER_THRESHOLDS.TIER_1) return 1;
    return 0;
}

function getLocalFlux(userId, guildId) {
    const row = db.getDb().prepare(
        'SELECT local_flux FROM user_trust_flux WHERE user_id = ? AND guild_id = ?'
    ).get(userId, guildId);
    return row?.local_flux || 0;
}

function getGlobalFlux(userId) {
    const row = db.getDb().prepare(
        'SELECT global_flux FROM user_global_flux WHERE user_id = ?'
    ).get(userId);
    return row?.global_flux || 0;
}

function modifyFlux(userId, guildId, delta, reason) {
    const current = getLocalFlux(userId, guildId);
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
    const names = ['Novizio', 'Membro', 'Residente', 'Veterano'];
    return names[tier] || 'Veterano';
}

module.exports = {
    register,
    getUserTier,
    getLocalFlux,
    getGlobalFlux,
    modifyFlux
};