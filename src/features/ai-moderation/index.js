// ============================================================================
// TODO: IMPLEMENTATION PLAN - AI MODERATION
// ============================================================================
// SCOPO: Analisi intelligente contenuti tramite LLM locale (LM Studio).
// Classifica messaggi per rilevare scam, hate speech, NSFW, minacce.
// Azioni semplificate: solo DELETE o BAN (con forward a SuperAdmin).
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: ai_config (per-gruppo)
// ├── guild_id: INTEGER PRIMARY KEY
// ├── ai_enabled: INTEGER (0/1, DEFAULT 1)
// ├── action_scam: TEXT (DEFAULT 'ban')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── action_hate: TEXT (DEFAULT 'report_only')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── action_nsfw: TEXT (DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── action_threat: TEXT (DEFAULT 'report_only')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── action_spam: TEXT (DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── confidence_threshold: REAL (DEFAULT 0.75)
// ├── context_aware: INTEGER (0/1, DEFAULT 1)
// ├── context_messages: INTEGER (DEFAULT 3)
// └── sensitivity: TEXT (DEFAULT 'medium')

// ----------------------------------------------------------------------------
// 2. INFRASTRUCTURE - LLM Locale (LM Studio)
// ----------------------------------------------------------------------------
//
// PROVIDER: LM Studio (https://lmstudio.ai/)
// ENDPOINT: process.env.LM_STUDIO_URL || 'http://localhost:1234'
// PATH: /v1/chat/completions
// TIMEOUT: 5000ms
//
// MODELLI CONSIGLIATI:
// 1. TheBloke/Mistral-7B-Instruct-v0.2-GGUF (Q4_K_M)
// 2. NousResearch/Hermes-2-Pro-Llama-3-8B-GGUF
// 3. microsoft/phi-2-GGUF
//
// HEALTHCHECK:
// └── Chiamata periodica a /v1/models per verificare stato

// ----------------------------------------------------------------------------
// 3. SYSTEM PROMPT - Classificazione
// ----------------------------------------------------------------------------
//
// CATEGORIE:
// - "safe": Contenuto normale
// - "scam": Truffe, phishing, fake giveaway
// - "hate": Discriminazione, razzismo
// - "nsfw": Contenuto sessuale
// - "threat": Minacce, doxxing
// - "spam": Promozione non richiesta
//
// RISPOSTA JSON:
// {"category": "...", "confidence": 0.0-1.0, "reason": "..."}

// ----------------------------------------------------------------------------
// 4. WORKFLOW - Flusso di Esecuzione
// ----------------------------------------------------------------------------
//
// TRIGGER: Ogni messaggio testuale
//
// STEP 1 - PRE-FILTERING:
// ├── Admin → Skip
// ├── Tier 2+ → Skip (trusted)
// ├── < 10 caratteri → Skip
// └── ai_enabled === false → Skip
//
// STEP 2 - CACHE CHECK:
// └── Hash contenuto, lookup cache (TTL 1h)
//
// STEP 3 - API CALL:
// └── fetch() a LM Studio con timeout
//
// STEP 4 - RESPONSE PARSING:
// └── Estrai JSON, valida schema
//
// STEP 5 - ACTION:
// └── Esegui action_[category] configurata

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
// │   │ 🔨 **BAN ESEGUITO (AI)**                   │
// │   │                                            │
// │   │ 🏛️ Gruppo: Nome Gruppo                    │
// │   │ 👤 Utente: @username (ID: 123456)         │
// │   │ 🤖 AI Category: SCAM (92%)                │
// │   │ 📝 Reason: Promette guadagni irrealistici │
// │   │                                            │
// │   │ 💬 Messaggio originale:                    │
// │   │ "Guadagna 1000€ al giorno! t.me/..."      │
// │   └────────────────────────────────────────────┘
// │   [ ➕ Blacklist Link ] [ ➕ Blacklist Pattern ]
// │   [ 🌍 Global Ban ] [ ✅ Solo Locale ]
// └── Auto-delete forward dopo 24h
//
// action === 'report_only':
// ├── NON eliminare, NON bannare
// └── Invia a staff locale:
//     ┌────────────────────────────────────────────┐
//     │ 🤖 **AI DETECTION REPORT**                 │
//     │ 📁 Categoria: HATE (87%)                  │
//     │ 👤 Utente: @username                       │
//     │ 💬 Messaggio: "testo..."                  │
//     └────────────────────────────────────────────┘
//     [ 🔨 Ban ] [ 🗑️ Delete ] [ ✅ Ignora ]

// ----------------------------------------------------------------------------
// 6. CONFIGURATION UI - /aiconfig
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ 🤖 **CONFIGURAZIONE AI MODERATION**        │
// │ Stato: 🟢 Attivo                           │
// │ Server: localhost:1234 (Online)            │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ 🤖 AI: ON ] [ 🔗 Test Connessione ]
// [ 🌡️ Sensibilità: ◀ Medium ▶ ]
// [ 🎭 Contesto: ON ]
// [ ⚙️ Configura Azioni Categoria ]
// [ 📊 Soglia: 75% ◀▶ ]
// [ 💾 Salva ] [ ❌ Chiudi ]
//
// SUBMENU AZIONI:
// [ 💸 SCAM: Ban ▼ ]    → [ Delete | Ban | Report ]
// [ 🗯️ HATE: Report ▼ ] → [ Delete | Ban | Report ]
// [ 🔞 NSFW: Delete ▼ ] → [ Delete | Ban | Report ]
// [ ⚔️ THREAT: Report ▼ ] → [ Delete | Ban | Report ]
// [ 📢 SPAM: Delete ▼ ] → [ Delete | Ban | Report ]
