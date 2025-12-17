// ============================================================================
// TODO: IMPLEMENTATION PLAN - LANGUAGE MONITOR
// ============================================================================
// SCOPO: Rilevamento lingua messaggi e enforcement di lingue permesse.
// Usa libreria 'franc' per detection. Supporta translation layer per tier alti.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL
// ----------------------------------------------------------------------------
//
// TABELLA: guild_config (campi language monitor)
// ├── lang_enabled: INTEGER (0/1, DEFAULT 0)
// │   └── Disabilitato di default (attivazione esplicita)
// ├── allowed_languages: TEXT (JSON Array, DEFAULT '["en"]')
// │   └── ISO 639-1 codes: 'it', 'en', 'es', 'de', 'fr', etc.
// ├── lang_action: TEXT (DEFAULT 'warn')
// │   └── Valori: 'delete', 'warn', 'report', 'nothing'
// ├── lang_min_chars: INTEGER (DEFAULT 20)
// │   └── Messaggi più corti non vengono analizzati
// ├── lang_confidence_threshold: REAL (DEFAULT 0.8)
// │   └── Confidenza minima franc per considerare rilevamento valido
// ├── lang_tier_bypass: INTEGER (DEFAULT 2)
// │   └── Tier >= questo bypass il filtro lingua
// └── lang_translation_enabled: INTEGER (0/1, DEFAULT 0)
//     └── Se 1, traduce messaggi invece di bloccarli

// ----------------------------------------------------------------------------
// 2. DETECTION LOGIC
// ----------------------------------------------------------------------------
//
// LIBRERIA: franc (https://github.com/wooorm/franc)
// └── Rilevamento lingua statistico basato su trigrammi
// └── Supporta 400+ lingue
// └── Output: ISO 639-3 code (3 lettere) → mappare a ISO 639-1
//
// TRIGGER: Ogni messaggio testuale
//
// STEP 1 - PRE-FILTERING:
// ├── IF message.text.length < lang_min_chars: SKIP
// ├── IF user.tier >= lang_tier_bypass: SKIP
// ├── IF lang_enabled === false: SKIP
// └── IF messaggio solo emoji/numeri/links: SKIP
//
// STEP 2 - LANGUAGE DETECTION:
// ├── result = franc(message.text)
// ├── IF result === 'und' (undefined): SKIP (troppo corto/ambiguo)
// ├── Converti ISO 639-3 → ISO 639-1 (es: 'ita' → 'it')
// └── confidence = franc.all(text)[0][1] (score 0-1)
//
// STEP 3 - VALIDATION:
// ├── IF confidence < lang_confidence_threshold: SKIP
// ├── IF detected_lang IN allowed_languages: PASS
// └── ELSE: VIOLATION
//
// MAPPING ISO COMUNE:
// ├── 'ita' → 'it' (Italiano)
// ├── 'eng' → 'en' (English)
// ├── 'spa' → 'es' (Español)
// ├── 'deu' → 'de' (Deutsch)
// ├── 'fra' → 'fr' (Français)
// ├── 'por' → 'pt' (Português)
// ├── 'rus' → 'ru' (Русский)
// └── 'ara' → 'ar' (العربية)

// ----------------------------------------------------------------------------
// 3. ACTION HANDLER
// ----------------------------------------------------------------------------
//
// action === 'delete':
// └── ctx.deleteMessage() silenzioso
//
// action === 'warn':
// ├── ctx.deleteMessage()
// └── ctx.reply("⚠️ In questo gruppo si parla solo: IT, EN")
//     └── Auto-delete dopo 30 secondi
//
// action === 'report':
// ├── NON eliminare
// └── Invia a staff:
//     ┌────────────────────────────────────────────┐
//     │ 🌐 **LINGUA NON PERMESSA**                 │
//     │                                            │
//     │ 👤 Utente: @username                       │
//     │ 🗣️ Lingua rilevata: Russo (ru)            │
//     │ 📊 Confidenza: 94%                         │
//     │ 💬 Messaggio: "Привет, как дела?"         │
//     └────────────────────────────────────────────┘
//     [ 🗑️ Delete ] [ ✅ Permetti ]
//
// action === 'nothing':
// └── NON agire, solo etichettare internamente
//     └── Utile per analytics/traduzione futura

// ----------------------------------------------------------------------------
// 4. TRANSLATION LAYER (Opzionale)
// ----------------------------------------------------------------------------
//
// Se lang_translation_enabled === true:
//
// FLUSSO ALTERNATIVO:
// 1. Messaggio in lingua non permessa rilevato
// 2. Invece di azione punitiva:
//    └── Chiamare API traduzione (TODO: decidere provider)
//    └── Postare traduzione come reply:
//        "🌐 [Tradotto da RU]: Ciao, come stai?"
// 3. Messaggio originale rimane visibile
//
// REQUISITI:
// ├── API Key per servizio traduzione
// ├── Rate limiting per costi
// └── Solo per Tier 1+ (anti-abuse)

// ----------------------------------------------------------------------------
// 5. CONFIGURATION UI - /langconfig
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ 🌐 **CONFIGURAZIONE LINGUA**               │
// │                                            │
// │ Stato: ✅ Attivo                           │
// │ Lingue permesse: IT, EN                   │
// │ Violazioni oggi: 12                        │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ 🌐 Filtro: ON ] [ ⚙️ Azione: Warn ▼ ]
// [ 🏳️ Lingue: IT, EN ] → [ Modifica ]
// [ 📊 Min Caratteri: 20 ] [ 🎯 Confidenza: 80% ]
// [ 🔓 Tier Bypass: 2 ] [ 🌍 Traduzione: OFF ]
// [ 💾 Salva ] [ ❌ Chiudi ]
//
// SUBMENU LINGUE (multi-select):
// [ ✅ IT ] [ ✅ EN ] [ ❌ ES ] [ ❌ DE ]
// [ ❌ FR ] [ ❌ PT ] [ ❌ RU ] [ ❌ AR ]
// [ 🔙 Indietro ]

// ----------------------------------------------------------------------------
// 6. EDGE CASES
// ----------------------------------------------------------------------------
//
// PROBLEMI NOTI CON FRANC:
// ├── Messaggi corti (< 20 char): molto inaffidabili
// ├── Code/snippet: spesso rilevati come lingue strane
// ├── Nomi propri: possono triggerare false positive
// ├── Emoji-heavy: score basso, meglio skippare
// └── Mixed language: rileva quella predominante
//
// MITIGAZIONI:
// ├── Soglia caratteri minima
// ├── Soglia confidenza alta
// ├── Bypass per tier alti
// └── action 'report' invece di delete per review

