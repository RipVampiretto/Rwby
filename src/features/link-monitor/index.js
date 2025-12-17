// ============================================================================
// TODO: IMPLEMENTATION PLAN - LINK MONITOR
// ============================================================================
// SCOPO: Controllo link/URL nei messaggi con whitelist/blacklist domini.
// Integrato con IntelNetwork per blacklist globale.
// Azioni semplificate: solo DELETE o BAN (con forward a SuperAdmin).
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: link_rules (per-gruppo)
// ├── id: INTEGER PRIMARY KEY
// ├── guild_id: INTEGER (0 = globale)
// ├── pattern: TEXT (dominio o wildcard)
// ├── type: TEXT ('whitelist', 'blacklist')
// ├── action: TEXT (solo blacklist, DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── category: TEXT ('scam', 'nsfw', 'spam', 'phishing')
// └── created_at: TEXT
//
// TABELLA: guild_config (campi link)
// ├── link_enabled: INTEGER (0/1, DEFAULT 1)
// ├── link_action_unknown: TEXT (DEFAULT 'report_only')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── link_sync_global: INTEGER (0/1, DEFAULT 1)
// └── link_tier_bypass: INTEGER (DEFAULT 1)

// ----------------------------------------------------------------------------
// 2. DETECTION LOGIC - Priorità
// ----------------------------------------------------------------------------
//
// 1. WHITELIST LOCALE → Pass
// 2. WHITELIST GLOBALE → Pass
// 3. BLACKLIST LOCALE → Azione definita
// 4. BLACKLIST GLOBALE → Azione definita
// 5. UNKNOWN → link_action_unknown

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
// │   │ 🔨 **BAN ESEGUITO (Link)**                 │
// │   │ 🏛️ Gruppo: Nome                           │
// │   │ 👤 Utente: @username                       │
// │   │ 🔗 Link: scam-site.com                    │
// │   │ 📁 Categoria: SCAM                        │
// │   │ 💬 "Clicca qui per guadagnare..."         │
// │   └────────────────────────────────────────────┘
// │   [ ➕ Blacklist Globale ] [ 🌍 Global Ban ]
// └── Auto-delete forward dopo 24h
//
// action === 'report_only':
// └── Staff locale decide:
//     [ 🔨 Ban ] [ 🗑️ Delete ]
//     [ ✅ Whitelist ] [ 🚫 Blacklist ]

// ----------------------------------------------------------------------------
// 4. CONFIGURATION UI - /linkconfig
// ----------------------------------------------------------------------------
//
// KEYBOARD:
// [ 🔗 Monitor: ON ] [ 🌐 Sync: ON ]
// [ ❓ Unknown: Report ▼ ] → [ Delete | Ban | Report ]
// [ ➕ Aggiungi ] [ 📜 Lista ]
// [ 💾 Salva ] [ ❌ Chiudi ]

// ============================================================================
// MODULE EXPORTS
// ============================================================================

let db = null;

function register(bot, database) {
    db = database;
    
    // Middleware: link detection
    bot.on("message:text", async (ctx, next) => {
        if (ctx.chat.type === 'private' || ctx.userTier >= 1) return next();
        // TODO: Implement link whitelist/blacklist
        await next();
    });
    
    // Command: /linkconfig
    bot.command("linkconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        await ctx.reply("🔗 Link config (TODO)");
    });
}

module.exports = { register };
