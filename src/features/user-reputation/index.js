// TODO: IMPLEMENTATION PLAN - USER REPUTATION ("TrustFlux" Dual Scope)
//
// 1. DATA MODEL (SQLite Table: 'user_trust_flux')
//    - `user_id`: Integer.
//    - `guild_id`: Integer.
//    - `local_flux`: Integer.
//    - `global_flux`: Integer.
//
// 2. LOGIC
//    - Manage Local Flux based on activity/reactions.
//    - On Significant Change (>50 pts):
//      - Emit `FLUX_UPDATE` event for `IntelNetwork`.
//
// 3. FIRST CONTACT
//    - On Join: Fetch `global_flux`.
//    - If High: Set Initial Tier = Residente.
//    - If Low: Set Initial Tier = Novizio (Checked by Profiler).
//
// 4. CONFIGURATION
//    - `/myflux`: Show Scores.