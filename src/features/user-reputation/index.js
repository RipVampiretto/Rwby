// TODO: IMPLEMENTATION PLAN - USER REPUTATION ("TrustFlux" Dual Scope)
//
// 1. DATA MODEL (SQLite Table: 'user_trust_flux')
//    - `user_id`: Integer.
//    - `guild_id`: Integer.
//    - `local_flux`: Integer (Group specific score).
//    - `global_flux`: Integer (Network wide score, synced).
//    - `last_active_date`: Date.
//    - `streak_days`: Integer.
//    - `vouched_by`: Integer.
//
// 2. DUAL SCOPE LOGIC
//    - **Local Flux**:
//      - Guadagnato/Perso solo in QUESTO gruppo.
//      - Determina i Tier locali (Novizio/Residente/Veterano) e i permessi in questo gruppo.
//    - **Global Flux**:
//      - Calcolato come media (o somma ponderata) del Local Flux di tutti i gruppi federati.
//      - Usato per il "First Contact": quando un utente entra in un NUOVO gruppo, il suo Tier iniziale dipende dal Global Flux.
//        - Global Flux Alto -> Parte come "Residente" (Tier 1) invece che "Novizio".
//        - Global Flux Basso -> Parte sorvegliato speciale.
//
// 3. FLUX DYNAMICS
//    - **Action**: Reactions (👍)
//      - Local: +2.
//      - Global: +0.5 (Trasmesso all'Intel Network).
//    - **Action**: Warn
//      - Local: -100.
//      - Global: -50.
//
// 4. SYNCING
//    - Ogni volta che il Flux cambia significativamente (delta > 50), invia aggiornamento all'Intel Network.
//
// 5. CONFIGURATION
//    - `/myflux` Shows:
//      - 🏠 Local Score: 120 (Residente)
//      - 🌍 Global Score: 500 (Affidabile)