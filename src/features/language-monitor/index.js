// ============================================================================
// TODO: IMPLEMENTATION PLAN - LANGUAGE MONITOR
// ============================================================================
// SCOPO: Rilevamento lingua messaggi e enforcement lingue permesse.
// Usa libreria 'franc' per detection.
// Azioni semplificate: solo DELETE o BAN (con forward a SuperAdmin).
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: guild_config (campi language)
// ├── lang_enabled: INTEGER (0/1, DEFAULT 0)
// ├── allowed_languages: TEXT (JSON Array, es: '["it", "en"]')
// ├── lang_action: TEXT (DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── lang_min_chars: INTEGER (DEFAULT 20)
// ├── lang_confidence_threshold: REAL (DEFAULT 0.8)
// └── lang_tier_bypass: INTEGER (DEFAULT 1)

// ----------------------------------------------------------------------------
// 2. DETECTION LOGIC - Analisi Lingua
// ----------------------------------------------------------------------------
//
// LIBRERIA: franc
// OUTPUT: ISO 639-3 → convertire a ISO 639-1
//
// STEP 1: Pre-filtering (skip < min_chars, skip Tier bypass)
// STEP 2: franc(text) → lingua rilevata
// STEP 3: Se confidence >= threshold e lingua NOT in allowed → VIOLATION

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
// ├── **FORWARD A SUPERADMIN** (per pattern abuso ripetuto)
// └── Auto-delete forward dopo 24h
//
// action === 'report_only':
// └── Invia a staff locale:
//     "Lingua rilevata: RU (94%)"
//     [ 🗑️ Delete ] [ ✅ Ignora ]

// ----------------------------------------------------------------------------
// 4. CONFIGURATION UI - /langconfig
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ 🌐 **CONFIGURAZIONE LINGUA**               │
// │ Lingue permesse: IT, EN                   │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ 🌐 Filtro: OFF ]
// [ 🏳️ Lingue: IT, EN ] → multi-select
// [ 👮 Azione: Delete ▼ ] → [ Delete | Ban | Report ]
// [ 💾 Salva ] [ ❌ Chiudi ]

// ============================================================================
// MODULE EXPORTS
// ============================================================================

let db = null;

function register(bot, database) {
    db = database;
    
    // Middleware: language detection
    bot.on("message:text", async (ctx, next) => {
        if (ctx.chat.type === 'private' || ctx.userTier >= 1) return next();
        // TODO: Implement franc language detection
        await next();
    });
    
    // Command: /langconfig
    bot.command("langconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        await ctx.reply("🌐 Language config (TODO)");
    });
}

module.exports = { register };
