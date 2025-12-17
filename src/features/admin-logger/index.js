// ============================================================================
// TODO: IMPLEMENTATION PLAN - ADMIN LOGGER
// ============================================================================
// SCOPO: Sistema centralizzato di logging per tutte le azioni di moderazione.
// Registra ban, delete, e azioni automatiche. Dual scope: locale e globale.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: guild_config (campi logger)
// ├── log_channel_id: INTEGER (nullable)
// │   └── ID topic o chat dove inviare log locali
// ├── log_events: TEXT (JSON Array)
// │   └── Eventi da loggare: ['ban', 'delete', 'ai_action', 'spam', 'config']
// └── log_format: TEXT ('minimal', 'standard', 'extended')
//     └── minimal: solo essenziale
//     └── standard: info complete
//     └── extended: debug/evidence allegata

// ----------------------------------------------------------------------------
// 2. LOGGING ENGINE - Funzione Centrale
// ----------------------------------------------------------------------------
//
// FUNZIONE: logEvent(params)
//
// PARAMETRI:
// ├── guildId: INTEGER
// ├── eventType: TEXT ('ban', 'delete', 'config_change', ...)
// ├── targetUser: Object ({ id, name, username })
// ├── executorAdmin: Object ({ id, name, username }) - o 'SYSTEM' se auto
// ├── reason: TEXT
// ├── proof: Object (nullable, allegati)
// ├── metadata: Object (dati extra modulo-specifici)
// └── isGlobal: BOOLEAN (se true, invia anche a SuperAdmin log)
//
// FLUSSO:
// 1. Lookup log_channel_id da guild_config
// 2. Check se eventType è in log_events
// 3. Format messaggio secondo log_format
// 4. Invia a log_channel_id locale
// 5. IF isGlobal: invia anche a global_log_channel

// ----------------------------------------------------------------------------
// 3. DUAL SCOPE ROUTING - Locale vs Globale
// ----------------------------------------------------------------------------
//
// EVENTI LOCALI:
// ├── Azioni admin manuali nel gruppo
// ├── Eliminazioni spam automatiche
// └── Cambio configurazione feature
//
// EVENTI GLOBALI (inviati anche a Parliament):
// ├── Tutti i BAN (automatici e manuali)
// ├── Rilevamenti AI critici (SCAM, THREAT)
// └── Cambi configurazione globale

// ----------------------------------------------------------------------------
// 4. CONFIGURATION UI - /logconfig
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ 📋 **CONFIGURAZIONE LOG**                  │
// │ Canale: #moderazione-log                   │
// │ Eventi attivi: 5/6                         │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ 📢 Canale ] → "Forwarda un messaggio dal canale"
// [ 📝 Formato: Standard ▼ ]
// [ ✅ Ban ] [ ✅ Delete ] [ ✅ AI ]
// [ ✅ Spam ] [ ❌ Config ] [ ✅ Flux ]
// [ 💾 Salva ] [ ❌ Chiudi ]

// ----------------------------------------------------------------------------
// 5. INTEGRATION
// ----------------------------------------------------------------------------
//
// DIPENDENZE IN INGRESSO (riceve da):
// ├── anti-spam → Ban/delete events
// ├── ai-moderation → AI detection events
// ├── anti-edit-abuse → Edit abuse events
// ├── link-monitor → Link ban events
// ├── keyword-monitor → Keyword ban events
// ├── language-monitor → Language events
// ├── nsfw-monitor → NSFW events
// ├── visual-immune-system → Visual match events
// ├── vote-ban → Community ban events
// └── super-admin → Global events
//
// FUNZIONE ESPOSTA:
// └── logEvent(params) → void
