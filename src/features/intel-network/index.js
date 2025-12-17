// ============================================================================
// TODO: IMPLEMENTATION PLAN - INTEL NETWORK (Federated Security)
// ============================================================================
// SCOPO: Rete federata di intelligence tra gruppi. Sincronizza ban, note,
// domini pericolosi e hash immagini tra tutti i gruppi della rete.
// Implementa sistema trust per pesare affidabilità dei dati condivisi.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Tabella intel_data
// ----------------------------------------------------------------------------
//
// TABELLA: intel_data (dati condivisi nella rete)
// ├── id: INTEGER PRIMARY KEY AUTOINCREMENT
// ├── type: TEXT (tipo di intel)
// │   └── 'ban' = Utente bannato globalmente
// │   └── 'whitelist_domain' = Dominio sicuro
// │   └── 'blacklist_domain' = Dominio pericoloso
// │   └── 'blacklist_word' = Parola/pattern blacklist
// │   └── 'image_hash' = Hash pHash immagine pericolosa
// │   └── 'global_note' = Nota su utente condivisa
// ├── value: TEXT (valore associato)
// │   └── Per 'ban': user_id
// │   └── Per domini: dominio senza protocollo
// │   └── Per word: pattern regex o stringa
// │   └── Per image: hash pHash
// │   └── Per note: JSON {userId, text, severity}
// ├── metadata: TEXT (JSON con dettagli aggiuntivi)
// │   └── reason, evidence_type, categories, etc.
// ├── added_by_guild: INTEGER (ID gruppo che ha aggiunto)
// ├── added_by_user: INTEGER (ID admin che ha aggiunto)
// ├── trust_weight: REAL (peso basato su source trust)
// ├── confirmations: INTEGER (quanti gruppi hanno confermato)
// ├── reports: INTEGER (quanti gruppi hanno segnalato false positive)
// ├── status: TEXT ('active', 'pending', 'revoked')
// └── created_at: TEXT (ISO timestamp)

// ----------------------------------------------------------------------------
// 2. DATA MODEL - Tabella guild_trust
// ----------------------------------------------------------------------------
//
// TABELLA: guild_trust (reputazione gruppi nella rete)
// ├── guild_id: INTEGER PRIMARY KEY
// ├── guild_name: TEXT (cache nome gruppo)
// ├── tier: INTEGER (0-3)
// │   └── 0 = Nuovo, non verificato
// │   └── 1 = Basic, qualche contributo
// │   └── 2 = Trusted, contributi affidabili
// │   └── 3 = Verified, gruppo ufficiale/premium
// ├── trust_score: INTEGER (0-100)
// │   └── Calcolato da: contributi validi, FP rate, anzianità
// ├── contributions_valid: INTEGER (intel confermate)
// ├── contributions_invalid: INTEGER (intel revocate)
// ├── joined_at: TEXT (quando si è unito alla rete)
// └── last_sync: TEXT (ultimo sync completato)

// ----------------------------------------------------------------------------
// 3. SYNC MECHANISM - Sincronizzazione Real-Time
// ----------------------------------------------------------------------------
//
// ARCHITETTURA: Event-driven con propagazione
//
// EVENTI IN ASCOLTO:
// ├── 'GLOBAL_BAN_ADD' → Nuovo ban da propagare
// │   └── Source: SuperAdmin ratifica, o gruppo Tier 2+ ban
// │   └── Action: Inserire in intel_data, broadcast a tutti i gruppi
// │
// ├── 'GLOBAL_BAN_REVOKE' → Revoca ban precedente
// │   └── Source: SuperAdmin o appeal approvato
// │   └── Action: Aggiornare status = 'revoked', broadcast
// │
// ├── 'FLUX_UPDATE' → Cambiamento TrustFlux significativo
// │   └── Source: user-reputation quando delta > 50 punti
// │   └── Action: Aggiornare cache globale, notificare gruppi interessati
// │
// ├── 'NOTE_ADD' → Nuova nota globale su utente
// │   └── Source: staff-coordination /gnote command
// │   └── Action: Inserire in intel_data type='global_note'
// │
// └── 'DOMAIN_FLAG' → Nuovo dominio segnalato
//     └── Source: link-monitor pattern detection
//     └── Action: Aggiungere a pending, richiedere conferma

// ----------------------------------------------------------------------------
// 4. TRUST-WEIGHTED PROPAGATION
// ----------------------------------------------------------------------------
//
// Non tutti i dati hanno stesso peso. Sistema trust determina:
//
// TRUST SCORE CALCULATION:
// trust_score = (valid / (valid + invalid * 2)) * 100
// └── Min: 0, Max: 100
// └── Penalizza falsi positivi il doppio
//
// PROPAGATION RULES:
// ├── Tier 0 (trust < 20):
// │   └── Dati vanno in 'pending', richiedono conferma SuperAdmin
// │   └── NON propagati automaticamente
// │
// ├── Tier 1 (trust 20-49):
// │   └── Dati propagati con flag 'unverified'
// │   └── Altri gruppi vedono warning prima di applicare
// │
// ├── Tier 2 (trust 50-79):
// │   └── Dati propagati normalmente
// │   └── Applicati automaticamente da gruppi Tier 1+
// │
// └── Tier 3 (trust 80-100):
//     └── Dati propagati con priorità
//     └── Applicati immediatamente ovunque

// ----------------------------------------------------------------------------
// 5. REPORTING FLOW - Da Locale a Globale
// ----------------------------------------------------------------------------
//
// COMANDO: /greport @user <reason>
// PERMESSI: Admin del gruppo
//
// FLUSSO:
// 1. Admin locale esegue /greport
// 2. Bot verifica Tier del gruppo
// 3. IF Tier < 2:
//    └── "⚠️ Serve Tier 2+ per report globali. Contatta SuperAdmin."
// 4. IF Tier >= 2:
//    └── Crea "Bill" (proposta) per SuperAdmin
//    └── Invia a Parliament topic 'proposals'
//
// FORMATO BILL:
// ┌────────────────────────────────────────────┐
// │ 📜 **GLOBAL REPORT #1234**                 │
// │                                            │
// │ 🏛️ Source: Nome Gruppo (Trust: 78%)       │
// │ 👤 Target: @username (ID: 123456)         │
// │ 📝 Reason: Spam organizzato               │
// │                                            │
// │ 📎 Evidence: [Forward allegato]           │
// │ 📊 Local Flux: -150                       │
// │ 🌍 Global Flux: 45                        │
// └────────────────────────────────────────────┘
// [ ✅ Ratify (Global Ban) ] [ ❌ Reject ] [ ⚠️ Flag Source ]

// ----------------------------------------------------------------------------
// 6. CONFIGURATION UI - /intel (Admin Only)
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ 🌐 **INTEL NETWORK STATUS**                │
// │                                            │
// │ Gruppo Tier: 2 (Trusted)                  │
// │ Trust Score: 78/100                       │
// │ Contributi: 23 validi, 2 invalidi         │
// │                                            │
// │ 🔄 Ultimo Sync: 2 minuti fa               │
// │ 📊 Intel attive: 1,234                    │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ 🔄 Sync: ✅ Bans ] [ 📝 Sync: ✅ Notes ]
// [ 🔗 Sync: ❌ Domains ] [ 🖼️ Sync: ❌ Images ]
// [ 📊 Statistiche Rete ]
// [ 💾 Salva ] [ ❌ Chiudi ]
//
// SYNC OPTIONS:
// └── Ogni tipo può essere abilitato/disabilitato per gruppo
// └── Utile per gruppi che vogliono solo ban sync, non notes