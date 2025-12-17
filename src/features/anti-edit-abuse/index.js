// ============================================================================
// TODO: IMPLEMENTATION PLAN - ANTI-EDIT ABUSE
// ============================================================================
// SCOPO: Rilevare abusi della funzione modifica messaggio.
// Tattica scammer: messaggio innocuo → modifica con link scam.
// Azioni semplificate: solo DELETE o BAN (con forward a SuperAdmin).
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: guild_config (campi edit-abuse)
// ├── edit_monitor_enabled: INTEGER (0/1, DEFAULT 1)
// ├── edit_abuse_action: TEXT (DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── edit_lock_tier0: INTEGER (0/1, DEFAULT 1)
// │   └── Se 1, Tier 0 NON può modificare messaggi
// ├── edit_similarity_threshold: REAL (DEFAULT 0.5)
// │   └── Sotto 50% similarità → sospetto
// └── edit_link_injection_action: TEXT (DEFAULT 'ban')
//     └── Azione specifica per link injection (sempre grave)
//
// TABELLA: message_snapshots (confronto before/after)
// ├── message_id, chat_id, user_id: INTEGER
// ├── original_text: TEXT
// ├── original_has_link: INTEGER (0/1)
// ├── created_at: TEXT (ISO timestamp)
// └── edit_count: INTEGER (DEFAULT 0)

// ----------------------------------------------------------------------------
// 2. SNAPSHOT SYSTEM - Cattura Stato Originale
// ----------------------------------------------------------------------------
//
// TRIGGER: Ogni nuovo messaggio testuale
// AZIONE: Salvare snapshot con testo originale e presenza link
// CLEANUP: Cronjob ogni ora elimina snapshot > 24h

// ----------------------------------------------------------------------------
// 3. DETECTION LOGIC - Rilevamento Abusi
// ----------------------------------------------------------------------------
//
// TRIGGER: Evento 'edited_message'
//
// CHECK A - LINK INJECTION (CRITICO):
// └── original_has_link === false && new_message ha link
// └── SEVERITY: CRITICAL → edit_link_injection_action (default: ban)
//
// CHECK B - SIMILARITY:
// └── Calcolo Levenshtein distance
// └── similarity = 1 - (distance / max(len1, len2))
// └── Se < threshold → Cambio drastico sospetto
//
// CHECK C - SUSPICIOUS PATTERNS:
// └── Nuovi pattern: t.me/, bit.ly, crypto, casino
// └── Pattern non presente prima → sospetto

// ----------------------------------------------------------------------------
// 4. TIER 0 EDIT LOCK
// ----------------------------------------------------------------------------
//
// Se edit_lock_tier0 === true:
// └── Utenti con local_flux < 100 NON possono modificare
// └── Azione: elimina modifica + avviso gentile
// └── NON conta come violazione (solo limitazione)

// ----------------------------------------------------------------------------
// 5. ACTION HANDLER - Solo Delete/Ban/Report
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
// │   │ 🔨 **BAN ESEGUITO (Edit Abuse)**           │
// │   │                                            │
// │   │ 🏛️ Gruppo: Nome Gruppo                    │
// │   │ 👤 Utente: @username (ID: 123456)         │
// │   │ ✏️ Tipo: Link Injection                   │
// │   │                                            │
// │   │ 📄 **PRIMA:** "Ciao, come state?"          │
// │   │ 📄 **DOPO:** "COMPRA CRYPTO: t.me/scam"   │
// │   │ 📊 Similarità: 12%                         │
// │   └────────────────────────────────────────────┘
// │   [ ➕ Blacklist Link ] [ 🌍 Global Ban ]
// └── Auto-delete forward dopo 24h
//
// action === 'report_only':
// ├── NON eliminare, NON bannare
// └── Invia a staff locale con before/after:
//     [ 🔨 Ban ] [ 🗑️ Delete ] [ ✅ Ignora ]

// ----------------------------------------------------------------------------
// 6. CONFIGURATION UI - /editconfig
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ ✏️ **CONFIGURAZIONE ANTI-EDIT ABUSE**      │
// │ Monitoraggio: ✅ | Edit rilevati: 47       │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ ✏️ Monitor: ON ] [ 🔒 Lock Tier 0: ON ]
// [ 📊 Soglia: 50% ◀▶ ]
// [ 🔗 Link Injection: Ban ▼ ] → [ Delete | Ban | Report ]
// [ 👮 Altro Abuso: Delete ▼ ] → [ Delete | Ban | Report ]
// [ 💾 Salva ] [ ❌ Chiudi ]

// ============================================================================
// MODULE EXPORTS
// ============================================================================

let db = null;

function register(bot, database) {
    db = database;
    
    // Handler: edited messages
    bot.on("edited_message", async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();
        // TODO: Implement edit abuse detection
        await next();
    });
    
    // Command: /editconfig
    bot.command("editconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        await ctx.reply("✏️ Anti-edit abuse config (TODO)");
    });
}

module.exports = { register };
