// ============================================================================
// TODO: IMPLEMENTATION PLAN - LINK MONITOR
// ============================================================================
// SCOPO: Controllo link/URL nei messaggi con whitelist/blacklist domini.
// Supporta policy configurabile per link sconosciuti. Integrato con IntelNetwork.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL
// ----------------------------------------------------------------------------
//
// TABELLA: link_rules (regole per-gruppo)
// ├── id: INTEGER PRIMARY KEY AUTOINCREMENT
// ├── guild_id: INTEGER (0 = globale via IntelNetwork)
// ├── pattern: TEXT (dominio o pattern)
// │   └── Esatto: "example.com"
// │   └── Wildcard: "*.example.com"
// │   └── Regex: "/crypto.*\\.io/i"
// ├── type: TEXT ('whitelist', 'blacklist')
// ├── action: TEXT (solo per blacklist)
// │   └── Valori: 'delete', 'warn', 'mute', 'kick', 'ban', 'report'
// ├── category: TEXT (opzionale: 'scam', 'nsfw', 'spam', 'phishing')
// ├── added_by: INTEGER (user ID che ha aggiunto)
// └── created_at: TEXT (ISO timestamp)
//
// TABELLA: guild_config (campi link monitor)
// ├── link_enabled: INTEGER (0/1, DEFAULT 1)
// ├── link_action_unknown: TEXT (DEFAULT 'report')
// │   └── Azione per link non in whitelist né blacklist
// ├── link_sync_global: INTEGER (0/1, DEFAULT 1)
// │   └── Se 1, usa anche regole da IntelNetwork
// ├── link_tier_bypass: INTEGER (DEFAULT 1)
// │   └── Tier >= questo può postare link liberamente
// ├── link_shortener_action: TEXT (DEFAULT 'report')
// │   └── Azione specifica per URL shortener (bit.ly, t.co, etc.)
// └── link_telegram_only: INTEGER (0/1, DEFAULT 0)
//     └── Se 1, permetti solo link t.me

// ----------------------------------------------------------------------------
// 2. LINK DETECTION
// ----------------------------------------------------------------------------
//
// TRIGGER: Ogni messaggio
//
// STEP 1 - ESTRAZIONE URL:
// ├── Da message.entities (type: 'url', 'text_link')
// ├── Da message.text con regex fallback
// └── Normalizza: rimuovi http(s)://, www., trailing slash
//
// STEP 2 - CLASSIFICAZIONE:
// FOR EACH extracted_url:
//   ├── domain = extractDomain(url)
//   ├── CHECK WHITELIST: local + global
//   │   └── IF match → PASS, next url
//   ├── CHECK BLACKLIST: local + global
//   │   └── IF match → VIOLATION con action da regola
//   ├── CHECK SHORTENER:
//   │   └── IF isShortener(domain) → link_shortener_action
//   └── UNKNOWN DOMAIN:
//       └── Applica link_action_unknown
//
// SHORTENER LIST (hardcoded):
// ├── bit.ly, bitly.com
// ├── t.co, tinyurl.com
// ├── goo.gl, is.gd, ow.ly
// ├── rebrand.ly, short.io
// └── Tutti i t.me/joinchat (invite links)

// ----------------------------------------------------------------------------
// 3. PRIORITY LOGIC
// ----------------------------------------------------------------------------
//
// ORDINE DI CONTROLLO (primo match vince):
// 1. WHITELIST LOCALE (massima priorità)
// 2. WHITELIST GLOBALE (IntelNetwork)
// 3. BLACKLIST LOCALE
// 4. BLACKLIST GLOBALE (IntelNetwork)
// 5. SHORTENER CHECK
// 6. UNKNOWN DOMAIN POLICY
//
// TIER BYPASS:
// └── IF user.tier >= link_tier_bypass: SKIP tutti i controlli

// ----------------------------------------------------------------------------
// 4. ACTION HANDLER
// ----------------------------------------------------------------------------
//
// action === 'delete':
// └── ctx.deleteMessage() silenzioso
//
// action === 'warn':
// ├── ctx.deleteMessage()
// └── ctx.reply("⚠️ Link non permesso in questo gruppo")
//
// action === 'mute':
// ├── ctx.deleteMessage()
// └── ctx.restrictChatMember() 1h
//
// action === 'kick':
// ├── ctx.deleteMessage()
// └── ctx.banChatMember() + unban
//
// action === 'ban':
// ├── ctx.deleteMessage()
// └── ctx.banChatMember() + segnala IntelNetwork
//
// action === 'report':
// ├── NON eliminare
// └── Invia a staff:
//     ┌────────────────────────────────────────────┐
//     │ 🔗 **LINK SOSPETTO RILEVATO**              │
//     │                                            │
//     │ 👤 Utente: @username (Tier 0)             │
//     │ 🌐 Dominio: sketchycrypto.biz             │
//     │ 📁 Stato: UNKNOWN (non in liste)          │
//     │ 💬 Messaggio: "Clicca qui: [link]"        │
//     └────────────────────────────────────────────┘
//     [ 🗑️ Delete ] [ 🔨 Ban ]
//     [ ✅ Whitelist ] [ 🚫 Blacklist ]

// ----------------------------------------------------------------------------
// 5. CONFIGURATION UI - /linkconfig
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ 🔗 **CONFIGURAZIONE LINK MONITOR**         │
// │                                            │
// │ Stato: ✅ Attivo                           │
// │ Regole: 23 whitelist, 156 blacklist       │
// │ Link bloccati oggi: 7                      │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ 🔗 Monitor: ON ] [ 🌐 Sync Globale: ON ]
// [ ❓ Link Sconosciuti: Report ▼ ]
// [ 🔗 URL Shortener: Report ▼ ]
// [ 🔓 Tier Bypass: 1 ]
// [ ➕ Aggiungi Regola ] [ 📜 Lista Regole ]
// [ 💾 Salva ] [ ❌ Chiudi ]
//
// WIZARD "AGGIUNGI REGOLA":
// 1. "Tipo:" [ Whitelist ✅ ] [ Blacklist 🚫 ]
// 2. "Dominio/pattern:" → User input
// 3. IF blacklist: "Azione:" [ Delete ] [ Ban ] [ Report ]
// 4. IF blacklist: "Categoria:" [ Scam ] [ NSFW ] [ Spam ]
// 5. Conferma e salva

// ----------------------------------------------------------------------------
// 6. INTEGRATION
// ----------------------------------------------------------------------------
//
// DIPENDENZE IN INGRESSO:
// ├── intel-network → Per blacklist/whitelist globali
// ├── user-reputation → Per tier check
// └── database → Per regole locali
//
// DIPENDENZE IN USCITA:
// ├── admin-logger → Per logging
// ├── staff-coordination → Per report
// └── intel-network → Per segnalare nuovi domini pericolosi

