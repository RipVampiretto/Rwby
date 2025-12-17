// ============================================================================
// TODO: IMPLEMENTATION PLAN - USER REPUTATION ("TrustFlux" Dual Scope)
// ============================================================================
// SCOPO: Sistema reputazione organico basato su attività e comportamento.
// TrustFlux = punteggio dinamico con scope locale (per-gruppo) e globale.
// Determina Tier utente che influenza tutti i moduli di moderazione.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL
// ----------------------------------------------------------------------------
//
// TABELLA: user_trust_flux (reputation per-utente/gruppo)
// ├── user_id: INTEGER
// ├── guild_id: INTEGER
// │   └── Combinazione (user_id, guild_id) = PRIMARY KEY
// ├── local_flux: INTEGER (DEFAULT 0)
// │   └── Punteggio locale al gruppo, range -1000 a +1000
// ├── created_at: TEXT (ISO timestamp primo messaggio)
// └── last_activity: TEXT (ISO timestamp ultima attività)
//
// TABELLA: user_global_flux (reputation globale)
// ├── user_id: INTEGER PRIMARY KEY
// ├── global_flux: INTEGER (DEFAULT 0)
// │   └── Media pesata dei local_flux, range -1000 a +1000
// ├── groups_participated: INTEGER
// │   └── Numero di gruppi dove utente è attivo
// ├── total_violations: INTEGER
// │   └── Contatore violazioni totali nella rete
// └── last_sync: TEXT (timestamp ultimo aggiornamento)

// ----------------------------------------------------------------------------
// 2. TIER SYSTEM - Classificazione Utenti
// ----------------------------------------------------------------------------
//
// TIER 0 - "Novizio" (local_flux < 100):
// ├── Nuovi utenti, non ancora verificati
// ├── Massime restrizioni: link blocked, edit locked, etc.
// └── Monitoraggio intensivo da IntelligentProfiler
//
// TIER 1 - "Membro" (local_flux 100-299):
// ├── Utenti con qualche attività positiva
// ├── Alcune restrizioni rimosse
// └── Può postare link a domini whitelisted
//
// TIER 2 - "Residente" (local_flux 300-499):
// ├── Utenti trusted con storico positivo
// ├── Bypass maggior parte filtri automatici
// └── Può essere nominato staff da admin
//
// TIER 3+ - "Veterano" (local_flux >= 500):
// ├── Utenti longtime con eccellente comportamento
// ├── Bypass quasi tutti i controlli automatici
// └── Solo AI moderation per contenuti gravi

// ----------------------------------------------------------------------------
// 3. FLUX CALCULATION - Guadagno/Perdita Punti
// ----------------------------------------------------------------------------
//
// GUADAGNO FLUX (azioni positive):
// ├── Messaggio testuale normale: +1 (max 10/ora)
// ├── Reazione ricevuta da altri: +2
// ├── Risposta a messaggio altrui: +1
// ├── Tempo nel gruppo (passivo): +1/giorno
// └── Report spam = confermato corretto: +10
//
// PERDITA FLUX (azioni negative):
// ├── Warning ricevuto: -20
// ├── Messaggio eliminato per spam: -10
// ├── Mute ricevuto: -30
// ├── Kick ricevuto: -50
// ├── Ban locale: -100 (azzeramento)
// └── Ban globale: -500 (e propagazione)
//
// FORMULE:
// └── local_flux = sum(all_actions_in_guild)
// └── global_flux = average(all_local_flux) weighted by activity

// ----------------------------------------------------------------------------
// 4. FIRST CONTACT - Nuovo Utente Join
// ----------------------------------------------------------------------------
//
// TRIGGER: Evento 'chat_member' status = 'member' (nuovo join)
//
// FLUSSO:
// 1. Utente entra nel gruppo
// 2. Fetch global_flux da user_global_flux
// 3. Determina initial_local_flux:
//    ├── IF global_flux >= 300: initial = 100 (start Tier 1)
//    ├── IF global_flux >= 0: initial = 50
//    └── IF global_flux < 0: initial = 0 (massima attenzione)
// 4. Crea record in user_trust_flux
// 5. Notifica IntelligentProfiler del nuovo utente
//
// RATIONALE:
// Utenti con buona reputazione globale iniziano con vantaggio.
// Utenti con pessima reputazione globale partono svantaggiati.

// ----------------------------------------------------------------------------
// 5. GLOBAL SYNC - Propagazione Cambiamenti
// ----------------------------------------------------------------------------
//
// TRIGGER: Cambiamento local_flux > 50 punti (evento significativo)
//
// FLUSSO:
// 1. Calcola nuovo global_flux:
//    └── Media pesata di tutti i local_flux
//    └── Peso = log(messaggi_nel_gruppo) per evitare manipulation
// 2. Aggiorna user_global_flux
// 3. Emetti evento 'FLUX_UPDATE' per IntelNetwork
// 4. IntelNetwork propaga a cache globale
//
// PROTEZIONE ANTI-MANIPULATION:
// ├── Rate limit su guadagno flux
// ├── Peso basso per gruppi nuovi/piccoli
// └── Diminishing returns dopo 500 flux

// ----------------------------------------------------------------------------
// 6. USER COMMANDS
// ----------------------------------------------------------------------------
//
// COMANDO: /myflux
// PERMESSI: Chiunque (mostra propri dati)
//
// OUTPUT:
// ┌────────────────────────────────────────────┐
// │ 📊 **IL TUO TRUSTFLUX**                    │
// │                                            │
// │ 🏠 Locale (questo gruppo): 245            │
// │ 🌍 Globale: 180                           │
// │ 🏷️ Tier: 1 - Membro                      │
// │                                            │
// │ 📈 Progressione:                           │
// │ ████████░░ 245/300 per Tier 2             │
// │                                            │
// │ ⏰ Nel gruppo da: 45 giorni               │
// │ 💬 Attivo in: 3 gruppi                    │
// └────────────────────────────────────────────┘
//
// COMANDO: /flux @user
// PERMESSI: Solo Admin/Staff
//
// OUTPUT simile ma per utente target

// ----------------------------------------------------------------------------
// 7. INTEGRATION
// ----------------------------------------------------------------------------
//
// DIPENDENZE IN USCITA (questo modulo fornisce dati a):
// ├── anti-spam → Tier per modulare severità
// ├── intelligent-profiler → Tier per controlli
// ├── anti-edit-abuse → Tier per edit lock
// ├── link-monitor → Tier per bypass
// ├── language-monitor → Tier per bypass
// ├── keyword-monitor → Tier per bypass
// ├── nsfw-monitor → Tier per bypass
// └── intel-network → global_flux per sync
//
// API ESPOSTA:
// ├── getUserTier(userId, guildId) → Number (0-3+)
// ├── getLocalFlux(userId, guildId) → Number
// ├── getGlobalFlux(userId) → Number
// ├── modifyFlux(userId, guildId, delta, reason) → void
// └── resetFlux(userId, guildId) → void