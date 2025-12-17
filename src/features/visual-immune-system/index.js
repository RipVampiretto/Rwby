// ============================================================================
// TODO: IMPLEMENTATION PLAN - VISUAL IMMUNE SYSTEM
// ============================================================================
// SCOPO: Rilevamento immagini pericolose tramite perceptual hashing.
// Database di hash immagini bannate, resistente a modifiche minori.
// Azioni semplificate: solo DELETE o BAN (con forward a SuperAdmin).
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: visual_hashes
// ├── id: INTEGER PRIMARY KEY
// ├── phash: TEXT (64-bit hex)
// ├── type: TEXT ('ban', 'safe')
// ├── category: TEXT ('scam', 'nsfw', 'gore', 'spam')
// ├── guild_id: INTEGER (0 = globale)
// ├── match_count: INTEGER
// └── created_at: TEXT
//
// TABELLA: guild_config (campi visual)
// ├── visual_enabled: INTEGER (0/1, DEFAULT 1)
// ├── visual_action: TEXT (DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── visual_sync_global: INTEGER (0/1, DEFAULT 1)
// └── visual_hamming_threshold: INTEGER (DEFAULT 5)

// ----------------------------------------------------------------------------
// 2. DETECTION LOGIC
// ----------------------------------------------------------------------------
//
// STEP 1: Download immagine
// STEP 2: Calcola pHash
// STEP 3: Confronta con database (Hamming distance)
// STEP 4: Se match → esegui action

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
// │   │ 🔨 **BAN ESEGUITO (Visual)**               │
// │   │ 🏛️ Gruppo: Nome                           │
// │   │ 👤 Utente: @username                       │
// │   │ 📊 Match: 98% (Hamming: 2)                │
// │   │ 📁 Categoria: SCAM                        │
// │   │ 🖼️ [Immagine]                             │
// │   │ 🔗 Hash: a1b2c3d4...                      │
// │   └────────────────────────────────────────────┘
// │   [ ➕ Blacklist Hash Globale ] [ 🌍 Global Ban ]
// └── Auto-delete forward dopo 24h
//
// action === 'report_only':
// └── Staff decide:
//     [ 🔨 Ban ] [ 🗑️ Delete ] [ ✅ Safe (Whitelist) ]

// ----------------------------------------------------------------------------
// 4. ADD TO DATABASE
// ----------------------------------------------------------------------------
//
// /visualban (reply a immagine):
// └── Calcola hash, salva come type='ban'
//
// /visualsafe (reply a immagine):
// └── Calcola hash, salva come type='safe'

// ----------------------------------------------------------------------------
// 5. CONFIGURATION UI - /visualconfig
// ----------------------------------------------------------------------------
//
// KEYBOARD:
// [ 🧬 Sistema: ON ] [ 🌐 Sync: ON ]
// [ 👮 Azione: Delete ▼ ] → [ Delete | Ban | Report ]
// [ 🎯 Soglia: 5 ◀▶ ]
// [ 💾 Salva ] [ ❌ Chiudi ]
