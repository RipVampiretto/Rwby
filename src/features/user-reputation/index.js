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