// ============================================================================
// TODO: IMPLEMENTATION PLAN - STAFF COORDINATION
// ============================================================================
// SCOPO: Hub centrale per coordinamento staff. Gestisce gruppo staff, topic
// forum, review queue per report automatici, e sistema note globali.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL
// ----------------------------------------------------------------------------
//
// TABELLA: guild_config (campi staff)
// ├── staff_group_id: INTEGER (nullable)
// │   └── ID del gruppo/supergroup dedicato allo staff
// ├── staff_topics: TEXT (JSON Object)
// │   └── { general: TID, reports: TID, logs: TID, appeals: TID }
// │   └── TID = Topic ID se gruppo è un Forum
// ├── staff_roles: TEXT (JSON Array)
// │   └── User IDs con ruolo staff (se non admin Telegram)
// └── review_mode: TEXT (DEFAULT 'async')
//     └── 'async' = Report non blocca utente
//     └── 'sync' = Utente mutato finché staff decide
//
// TABELLA: global_notes (note su utenti)
// ├── id: INTEGER PRIMARY KEY
// ├── user_id: INTEGER (utente target)
// ├── guild_id: INTEGER (gruppo che ha creato nota)
// ├── note_text: TEXT
// ├── severity: TEXT ('info', 'warning', 'critical')
// ├── created_by: INTEGER (staff che ha creato)
// ├── created_at: TEXT (ISO timestamp)
// └── is_global: INTEGER (0 = locale, 1 = condivisa rete)

// ----------------------------------------------------------------------------
// 2. STAFF SETUP - /setstaff
// ----------------------------------------------------------------------------
//
// COMANDO: /setstaff
// PERMESSI: Solo owner o admin con full permissions
// SCOPE: Eseguito nel gruppo principale, configura gruppo staff
//
// FLUSSO:
// 1. Admin esegue /setstaff in gruppo principale
// 2. Bot chiede: "Inoltrami un messaggio dal gruppo staff"
// 3. Admin inoltra messaggio
// 4. Bot estrae chat.id
// 5. Bot verifica:
//    ├── È un supergroup/group?
//    ├── Bot è admin nel gruppo staff?
//    └── Bot ha permessi gestione topic (se Forum)?
// 6. Se gruppo staff è Forum:
//    ├── Crea topic "📥 Report"
//    ├── Crea topic "📋 Log"
//    ├── Crea topic "🗣️ Discussione"
//    └── Salva topic IDs in staff_topics
// 7. Salva staff_group_id in DB
// 8. Conferma: "✅ Gruppo staff configurato!"

// ----------------------------------------------------------------------------
// 3. REVIEW QUEUE - Router Report
// ----------------------------------------------------------------------------
//
// FUNZIONE: reviewQueue(params)
// Riceve report da tutti i moduli di moderazione
//
// PARAMETRI:
// ├── sourceModule: String ('anti-spam', 'ai-moderation', etc.)
// ├── reportType: String ('spam', 'nsfw', 'link', 'language', etc.)
// ├── severity: String ('low', 'medium', 'high', 'critical')
// ├── targetUser: Object ({ id, name, username })
// ├── targetMessage: Object (messaggio originale)
// ├── context: Object (dettagli specifici del modulo)
// └── suggestedActions: Array (['ban', 'mute', 'delete', 'ignore'])
//
// FLUSSO:
// 1. Ricevi report da modulo source
// 2. Formatta messaggio uniforme
// 3. Determina topic corretto (staff_topics.reports)
// 4. Invia a gruppo staff con inline keyboard
// 5. Registra in tabella pending_reviews
// 6. Se review_mode === 'sync': muta utente temporaneamente
//
// FORMATO REPORT:
// ┌────────────────────────────────────────────┐
// │ 📥 **REVIEW REQUEST** #1234               │
// │                                            │
// │ 🔧 Source: Anti-Spam                      │
// │ ⚠️ Severity: HIGH                         │
// │ ⏰ Time: 14:30:25                         │
// │                                            │
// │ 👤 Utente: @username (ID: 123456)         │
// │ 📊 TrustFlux: 45 (Tier 0)                 │
// │                                            │
// │ 📝 Trigger: Volume flood (15 msg/min)     │
// │ 💬 Messaggio: "spam spam spam..."         │
// └────────────────────────────────────────────┘
// [ ✅ Allow ] [ 🔨 Ban ] [ 🔊 Mute ] [ 🗑️ Delete ]
//
// CALLBACK HANDLERS:
// ├── review_allow_X → Ignora, ripristina permessi se sync
// ├── review_ban_X → Ban utente, log, decrementa flux
// ├── review_mute_X → Mute configurabile
// └── review_delete_X → Solo elimina messaggio

// ----------------------------------------------------------------------------
// 4. GLOBAL NOTE SYSTEM - /gnote
// ----------------------------------------------------------------------------
//
// COMANDO: /gnote <user> <severity> <text>
// PERMESSI: Staff del gruppo
//
// ESEMPIO: /gnote @username warning Comportamento sospetto
//
// FLUSSO:
// 1. Parse comando e argomenti
// 2. Verifica utente esiste
// 3. Crea record in global_notes
// 4. Se is_global = true:
//    └── IntelNetwork.broadcastNote(note)
// 5. Conferma: "✅ Nota aggiunta per @username"
//
// COMANDO: /notes <user>
// Mostra tutte le note su un utente
//
// OUTPUT:
// ┌────────────────────────────────────────────┐
// │ 📝 **NOTE SU @username**                   │
// │                                            │
// │ ⚠️ [WARNING] 2024-12-15 - Gruppo A        │
// │    "Comportamento sospetto"                │
// │                                            │
// │ ℹ️ [INFO] 2024-12-10 - Gruppo B           │
// │    "Primo avviso spam"                     │
// └────────────────────────────────────────────┘

// ----------------------------------------------------------------------------
// 5. CONFIGURATION UI
// ----------------------------------------------------------------------------
//
// Non ha un comando /config dedicato, ma:
//
// COMANDI DISPONIBILI:
// ├── /setstaff → Setup gruppo staff
// ├── /gnote → Aggiungi nota globale
// ├── /notes → Visualizza note utente
// ├── /stafflist → Mostra staff configurato
// └── /reviewmode [sync|async] → Cambia modalità review

// ----------------------------------------------------------------------------
// 6. INTEGRATION
// ----------------------------------------------------------------------------
//
// DIPENDENZE IN INGRESSO:
// ├── anti-spam → Invia report spam
// ├── ai-moderation → Invia report AI
// ├── link-monitor → Invia report link
// ├── language-monitor → Invia report lingua
// ├── keyword-monitor → Invia report keyword
// ├── nsfw-monitor → Invia report NSFW
// ├── intelligent-profiler → Invia report nuovi utenti
// └── anti-edit-abuse → Invia report edit sospetti
//
// DIPENDENZE IN USCITA:
// ├── admin-logger → Per logging azioni staff
// └── intel-network → Per broadcast note globali

