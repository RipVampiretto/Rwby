// ============================================================================
// TODO: IMPLEMENTATION PLAN - ML CLUSTER DETECTION
// ============================================================================
// SCOPO: Rilevamento automatico raid e attacchi coordinati tramite analisi
// pattern di join/messaggi. Identifica cluster di utenti sospetti per azione.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL
// ----------------------------------------------------------------------------
//
// TABELLA: guild_config (campi ml-cluster)
// ├── cluster_enabled: INTEGER (0/1, DEFAULT 1)
// ├── cluster_join_threshold: INTEGER (DEFAULT 10)
// │   └── N join in finestra temporale → Attiva alert
// ├── cluster_join_window_minutes: INTEGER (DEFAULT 5)
// ├── cluster_message_threshold: INTEGER (DEFAULT 20)
// │   └── N messaggi simili da utenti diversi → Cluster
// ├── cluster_action: TEXT (DEFAULT 'report_only')
// │   └── Valori: 'lockdown', 'auto_ban', 'report_only'
// └── cluster_auto_lockdown: INTEGER (0/1, DEFAULT 0)
//     └── Se 1, lockdown automatico senza intervento staff
//
// TABELLA: join_events (tracking join real-time)
// ├── user_id: INTEGER
// ├── guild_id: INTEGER
// ├── joined_at: TEXT (ISO timestamp)
// ├── invite_link: TEXT (nullable, se tracciabile)
// └── user_metadata: TEXT (JSON: username pattern, account age, etc.)

// ----------------------------------------------------------------------------
// 2. CLUSTER DETECTION LOGIC
// ----------------------------------------------------------------------------
//
// TIPO A - JOIN BURST DETECTION:
// Rileva molti join in breve tempo (tipico di raid organizzati)
//
// STEP 1 - Monitor join events:
// └── Su evento 'chat_member' con status 'member' (nuovo join)
//
// STEP 2 - Count recent joins:
// SELECT COUNT(*) FROM join_events 
// WHERE guild_id = ? AND joined_at > datetime('now', '-X minutes')
//
// STEP 3 - Threshold check:
// └── IF count >= cluster_join_threshold: TRIGGER RAID ALERT
//
// TIPO B - MESSAGE SIMILARITY CLUSTERING:
// Rileva messaggi simili/identici da più utenti (spam wave)
//
// STEP 1 - Track message hashes:
// └── Hash normalizzato del contenuto messaggio
//
// STEP 2 - Count similar messages:
// └── In finestra 5 minuti, da utenti diversi
//
// STEP 3 - Threshold check:
// └── IF count >= cluster_message_threshold: TRIGGER SPAM WAVE
//
// TIPO C - ACCOUNT PATTERN ANALYSIS:
// Analisi caratteristiche account per clustering
//
// FATTORI:
// ├── Account age < 7 giorni
// ├── Username pattern simile (bot_123, user_456)
// ├── No profile picture
// ├── No bio/username
// ├── Stesso invite link usato
// └── Tempo join molto ravvicinato

// ----------------------------------------------------------------------------
// 3. ACTION HANDLER
// ----------------------------------------------------------------------------
//
// action === 'lockdown':
// ├── ctx.setChatPermissions({ can_send_messages: false }) per Tier 0
// ├── Annuncio in chat: "🚨 LOCKDOWN ATTIVO - Raid in corso"
// ├── Solo Tier 2+ possono scrivere
// ├── Durata: configurabile (default 30 min)
// └── Staff notificato per review
//
// action === 'auto_ban':
// ├── Per ogni utente nel cluster sospetto:
// │   └── ctx.banChatMember(userId)
// ├── Log dettagliato per ogni ban
// ├── Decrementa global_flux per ogni utente
// └── ⚠️ ALTO RISCHIO FALSE POSITIVE - usare con cautela
//
// action === 'report_only':
// ├── NON agire automaticamente
// └── Invia alert a staff:
//     ┌────────────────────────────────────────────┐
//     │ 🚨 **POTENZIALE RAID RILEVATO**            │
//     │                                            │
//     │ 📈 Join negli ultimi 5 min: 25            │
//     │ 👥 Utenti coinvolti: 23                   │
//     │ 🔗 Invite link comune: t.me/+abc123       │
//     │                                            │
//     │ 📊 Pattern rilevati:                       │
//     │ - 80% senza foto profilo                   │
//     │ - 90% account < 7 giorni                   │
//     │ - 60% username XXX_1234                    │
//     └────────────────────────────────────────────┘
//     [ 🔒 Lockdown ] [ 🔨 Ban All ] [ ✅ Ignora ]

// ----------------------------------------------------------------------------
// 4. LOCKDOWN MODE
// ----------------------------------------------------------------------------
//
// ATTIVAZIONE:
// ├── Automatica: Se cluster_auto_lockdown === true
// └── Manuale: Staff clicca "Lockdown" da report
//
// EFFETTI:
// ├── Tutti gli utenti Tier 0: can_send_messages = false
// ├── Tier 1+: Possono scrivere normalmente
// ├── Nuovi join: Vengono mutati automaticamente
// └── Messaggio pinnato: "Modalità emergenza attiva"
//
// DISATTIVAZIONE:
// ├── Automatica dopo timeout configurato
// ├── Manuale: Staff comando /unlockdown
// └── Ripristina permessi normali

// ----------------------------------------------------------------------------
// 5. CONFIGURATION UI - /mlconfig
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ 🔬 **CONFIGURAZIONE ML CLUSTER**           │
// │                                            │
// │ Stato: ✅ Attivo                           │
// │ Raid rilevati (30gg): 3                    │
// │ Ultimo alert: 5 giorni fa                  │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ 🔬 Detection: ON ] [ 🔒 Auto-Lockdown: OFF ]
// [ 📊 Soglia Join: 10 ] [ ⏱️ Finestra: 5 min ]
// [ 👮 Azione: Report ▼ ]
// [ 💾 Salva ] [ ❌ Chiudi ]

