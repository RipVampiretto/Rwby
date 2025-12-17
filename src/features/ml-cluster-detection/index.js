// ============================================================================
// TODO: IMPLEMENTATION PLAN - ML CLUSTER DETECTION
// ============================================================================
// SCOPO: Rilevamento raid/attacchi coordinati tramite pattern analysis.
// Identifica cluster di utenti sospetti (join burst, messaggi simili).
// Azioni semplificate: solo LOCKDOWN, AUTO_BAN, o REPORT.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: guild_config (campi ml-cluster)
// ├── cluster_enabled: INTEGER (0/1, DEFAULT 1)
// ├── cluster_join_threshold: INTEGER (DEFAULT 10)
// ├── cluster_join_window_minutes: INTEGER (DEFAULT 5)
// ├── cluster_action: TEXT (DEFAULT 'report_only')
// │   └── Valori: 'lockdown', 'auto_ban', 'report_only'
// └── cluster_auto_lockdown: INTEGER (0/1, DEFAULT 0)
//
// TABELLA: join_events (tracking)
// ├── user_id, guild_id: INTEGER
// ├── joined_at: TEXT
// └── user_metadata: TEXT (JSON)

// ----------------------------------------------------------------------------
// 2. DETECTION LOGIC
// ----------------------------------------------------------------------------
//
// JOIN BURST: Troppi join in poco tempo → RAID ALERT
// MESSAGE CLUSTER: Messaggi simili da utenti diversi → SPAM WAVE

// ----------------------------------------------------------------------------
// 3. ACTION HANDLER
// ----------------------------------------------------------------------------
//
// action === 'lockdown':
// ├── Tier 0 → can_send_messages = false
// ├── Annuncio: "🚨 LOCKDOWN"
// └── Durata configurabile, auto-sblocco
//
// action === 'auto_ban':
// ├── Ban tutti utenti nel cluster sospetto
// ├── **FORWARD A SUPERADMIN** per ogni ban:
// │   ┌────────────────────────────────────────────┐
// │   │ 🔨 **MASS BAN (Raid Detection)**           │
// │   │ 🏛️ Gruppo: Nome                           │
// │   │ 👥 Utenti bannati: 15                     │
// │   │ ⏱️ Join window: 3 minuti                  │
// │   │ 📊 Pattern: 80% senza foto, 90% nuovi     │
// │   └────────────────────────────────────────────┘
// │   [ 🌍 Global Ban All ]
// └── Auto-delete forward dopo 24h
//
// action === 'report_only':
// └── Alert a staff locale:
//     [ 🔒 Lockdown ] [ 🔨 Ban All ] [ ✅ Ignora ]

// ----------------------------------------------------------------------------
// 4. CONFIGURATION UI - /mlconfig
// ----------------------------------------------------------------------------
//
// KEYBOARD:
// [ 🔬 Detection: ON ] [ 🔒 Auto-Lockdown: OFF ]
// [ 📊 Soglia: 10 ] [ ⏱️ Finestra: 5 min ]
// [ 👮 Azione: Report ▼ ] → [ Lockdown | Auto-Ban | Report ]
// [ 💾 Salva ] [ ❌ Chiudi ]
