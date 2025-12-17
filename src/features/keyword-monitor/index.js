// ============================================================================
// TODO: IMPLEMENTATION PLAN - KEYWORD MONITOR (Blacklist)
// ============================================================================
// SCOPO: Filtro parole/frasi vietate con supporto regex.
// Ogni parola può avere azione indipendente.
// Azioni semplificate: solo DELETE o BAN (con forward a SuperAdmin).
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: word_filters
// ├── id: INTEGER PRIMARY KEY AUTOINCREMENT
// ├── guild_id: INTEGER (0 = globale da IntelNetwork)
// ├── word: TEXT (stringa o pattern regex)
// ├── is_regex: INTEGER (0/1)
// ├── action: TEXT (DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── category: TEXT ('spam', 'hate', 'nsfw', 'custom')
// ├── severity: INTEGER (1-5, priorità matching)
// ├── match_whole_word: INTEGER (0/1)
// ├── bypass_tier: INTEGER (DEFAULT 2)
// └── created_at: TEXT (ISO timestamp)

// ----------------------------------------------------------------------------
// 2. MATCHING LOGIC - Rilevamento
// ----------------------------------------------------------------------------
//
// STEP 1: Fetch filtri locali + globali
// STEP 2: Normalizza testo (lowercase, rimuovi accenti)
// STEP 3: Per ogni filtro:
//         - regex → test()
//         - whole_word → \\b{word}\\b
//         - else → includes()
// STEP 4: Prima match → esegui action

// ----------------------------------------------------------------------------
// 3. ACTION HANDLER - Solo Delete/Ban/Report
// ----------------------------------------------------------------------------
//
// action === 'delete':
// └── ctx.deleteMessage() silenzioso
//
// action === 'ban':
// ├── ctx.deleteMessage()
// ├── ctx.banChatMember(userId)
// ├── **FORWARD A SUPERADMIN**:
// │   ┌────────────────────────────────────────────┐
// │   │ 🔨 **BAN ESEGUITO (Keyword)**              │
// │   │ 🏛️ Gruppo: Nome                           │
// │   │ 👤 Utente: @username                       │
// │   │ 🎯 Keyword: "parola_vietata"              │
// │   │ 📁 Categoria: HATE                        │
// │   │ 💬 "messaggio con parola_vietata..."      │
// │   └────────────────────────────────────────────┘
// │   [ ➕ Blacklist Globale ] [ 🌍 Global Ban ]
// └── Auto-delete forward dopo 24h
//
// action === 'report_only':
// └── Invia a staff locale per review

// ----------------------------------------------------------------------------
// 4. CONFIGURATION UI - /wordconfig
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ 🔤 **PAROLE VIETATE**                      │
// │ Filtri: 47 (35 locali, 12 globali)        │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ ➕ Aggiungi Parola ] [ 📜 Lista ]
// [ 🌐 Sync Globale: ON ]
// [ ❌ Chiudi ]
//
// WIZARD AGGIUNGI:
// 1. "Digita parola:" → input
// 2. "Regex?" [ Sì | No ]
// 3. "Azione:" [ Delete | Ban | Report ]
