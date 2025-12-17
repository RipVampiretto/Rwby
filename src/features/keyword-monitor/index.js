// ============================================================================
// TODO: IMPLEMENTATION PLAN - KEYWORD MONITOR (Blacklist)
// ============================================================================
// SCOPO: Filtro parole/frasi vietate con supporto regex. Ogni parola può
// avere azione indipendente. Supporta categorie e priorità.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL
// ----------------------------------------------------------------------------
//
// TABELLA: word_filters (regole di filtraggio)
// ├── id: INTEGER PRIMARY KEY AUTOINCREMENT
// ├── guild_id: INTEGER (0 = globale, altrimenti locale)
// ├── word: TEXT (stringa o pattern regex)
// ├── is_regex: INTEGER (0/1)
// │   └── Se 1, word è interpretato come regex
// │   └── Se 0, word è match esatto case-insensitive
// ├── action: TEXT ('delete', 'warn', 'mute', 'kick', 'ban', 'report')
// ├── category: TEXT (opzionale: 'spam', 'hate', 'nsfw', 'custom')
// ├── severity: INTEGER (1-5, per priorità matching)
// ├── match_whole_word: INTEGER (0/1)
// │   └── Se 1, "ass" non matcha "assistant"
// ├── bypass_tier: INTEGER (DEFAULT 2)
// │   └── Utenti >= questo tier bypassano il filtro
// └── created_at: TEXT (ISO timestamp)

// ----------------------------------------------------------------------------
// 2. MATCHING LOGIC
// ----------------------------------------------------------------------------
//
// TRIGGER: Ogni messaggio testuale
//
// STEP 1 - FETCH FILTERS:
// └── SELECT * FROM word_filters WHERE guild_id IN (0, ctx.chat.id)
// └── Ordina per severity DESC (alta priorità prima)
//
// STEP 2 - PRE-PROCESSING TESTO:
// └── Normalizza: lowercase, rimuovi accenti
// └── Espandi: "c0mpra" → "compra", "b1tc0in" → "bitcoin"
// └── Mantieni originale per log
//
// STEP 3 - MATCHING:
// FOR EACH filter:
//   IF is_regex:
//     └── new RegExp(filter.word, 'gi').test(normalizedText)
//   ELSE IF match_whole_word:
//     └── \\b{word}\\b pattern matching
//   ELSE:
//     └── normalizedText.includes(filter.word)
//
//   IF match:
//     └── RETURN filter (prima match vince per priorità)
//
// STEP 4 - CHECK BYPASS:
// └── IF user.tier >= filter.bypass_tier: SKIP action

// ----------------------------------------------------------------------------
// 3. ACTION HANDLER
// ----------------------------------------------------------------------------
//
// action === 'delete':
// └── ctx.deleteMessage() silenzioso
//
// action === 'warn':
// ├── ctx.deleteMessage()
// └── ctx.reply("⚠️ Messaggio rimosso: linguaggio non appropriato")
//
// action === 'mute':
// ├── ctx.deleteMessage()
// └── ctx.restrictChatMember() per 1h
//
// action === 'kick':
// ├── ctx.deleteMessage()
// └── ctx.banChatMember() + unban
//
// action === 'ban':
// ├── ctx.deleteMessage()
// └── ctx.banChatMember() permanente
//
// action === 'report':
// ├── NON eliminare
// └── Invia a staff:
//     ┌────────────────────────────────────────────┐
//     │ 🔤 **KEYWORD HIT DETECTED**                │
//     │                                            │
//     │ 👤 Utente: @username                       │
//     │ 🎯 Hit: "parola_vietata"                  │
//     │ 📁 Categoria: HATE                        │
//     │ 💬 Messaggio: "testo completo..."         │
//     └────────────────────────────────────────────┘
//     [ 🗑️ Delete ] [ 🔨 Ban ] [ ✅ False Positive ]

// ----------------------------------------------------------------------------
// 4. CONFIGURATION UI - /wordconfig
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ 🔤 **GESTIONE PAROLE VIETATE**             │
// │                                            │
// │ Filtri attivi: 47 (35 locali, 12 globali) │
// │ Match oggi: 23                             │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ ➕ Aggiungi Parola ] [ 📜 Lista Filtri ]
// [ 🌐 Sync Globale: ON ] [ 📊 Statistiche ]
// [ ❌ Chiudi ]
//
// WIZARD "AGGIUNGI PAROLA":
// 1. "Digita la parola/pattern da bloccare:"
//    └── User input: "crypto"
// 2. "È un pattern regex?" [ Sì ] [ No ]
// 3. "Match parola intera?" [ Sì ] [ No ]
// 4. "Azione:" [ Delete ] [ Warn ] [ Mute ] [ Ban ] [ Report ]
// 5. "Categoria:" [ Spam ] [ Hate ] [ NSFW ] [ Custom ]
// 6. "Tier bypass:" [ 0 ] [ 1 ] [ 2 ] [ 3 ]
// 7. Conferma e salva
//
// LISTA FILTRI (paginata):
// ┌────────────────────────────────────────────┐
// │ 1. "crypto" [Delete] Tier 2+ bypass       │
// │ 2. "/bitcoin/i" (regex) [Report] Spam     │
// │ 3. "parola_brutta" [Ban] Hate             │
// └────────────────────────────────────────────┘
// [ ◀ Prev ] [ 1/5 ] [ Next ▶ ] [ 🗑️ Elimina ]

