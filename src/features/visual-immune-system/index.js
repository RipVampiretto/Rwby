// ============================================================================
// TODO: IMPLEMENTATION PLAN - VISUAL IMMUNE SYSTEM
// ============================================================================
// SCOPO: Rilevamento immagini pericolose tramite perceptual hashing (pHash).
// Mantiene database di hash immagini bannate e le rileva anche se modificate.
// Integrato con IntelNetwork per condivisione hash tra gruppi.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL
// ----------------------------------------------------------------------------
//
// TABELLA: visual_hashes (database hash immagini)
// ├── id: INTEGER PRIMARY KEY AUTOINCREMENT
// ├── phash: TEXT (hash perceptual, es: 64-bit hex)
// ├── type: TEXT ('ban', 'safe')
// │   └── 'ban' = Immagine pericolosa da bloccare
// │   └── 'safe' = Whitelist per evitare false positive
// ├── category: TEXT (nullable: 'scam', 'nsfw', 'gore', 'spam')
// ├── guild_id: INTEGER (0 = globale, altrimenti locale)
// ├── added_by: INTEGER (user ID che ha aggiunto)
// ├── source_evidence: TEXT (nullable, riferimento al messaggio originale)
// ├── match_count: INTEGER (quante volte è stato matchato)
// └── created_at: TEXT (ISO timestamp)
//
// TABELLA: guild_config (campi visual)
// ├── visual_enabled: INTEGER (0/1, DEFAULT 1)
// ├── visual_action: TEXT (DEFAULT 'delete')
// │   └── Valori: 'auto_ban', 'delete', 'report'
// ├── visual_sync_global: INTEGER (0/1, DEFAULT 1)
// │   └── Se 1, usa anche hash da IntelNetwork
// ├── visual_hamming_threshold: INTEGER (DEFAULT 5)
// │   └── Distanza massima Hamming per considerare match
// │   └── 0 = match esatto, 10 = molto permissivo
// └── visual_tier_bypass: INTEGER (DEFAULT 3)
//     └── Solo Tier 3+ bypass

// ----------------------------------------------------------------------------
// 2. PERCEPTUAL HASHING - Teoria
// ----------------------------------------------------------------------------
//
// LIBRERIA: imghash, sharp, o simile
//
// ALGORITMO pHash:
// 1. Resize immagine a 32x32
// 2. Converti in grayscale
// 3. Applica DCT (Discrete Cosine Transform)
// 4. Prendi top-left 8x8 coefficienti
// 5. Calcola media coefficienti
// 6. Per ogni pixel: 1 se > media, 0 se <= media
// 7. Risultato: 64 bit = 16 caratteri hex
//
// PROPRIETÀ:
// ├── Resistente a resize
// ├── Resistente a compressione
// ├── Resistente a crop moderato
// ├── Resistente a cambi colore
// └── Sensibile a mirror/rotazione (gestire separatamente)
//
// HAMMING DISTANCE:
// = Numero di bit diversi tra due hash
// └── 0 = identici, 1-5 = molto simili, 6-10 = simili, >10 = diversi

// ----------------------------------------------------------------------------
// 3. DETECTION LOGIC
// ----------------------------------------------------------------------------
//
// TRIGGER: Messaggi con photo, sticker (animated esclusi)
//
// STEP 1 - DOWNLOAD:
// └── ctx.telegram.getFile(file_id) → Download buffer
//
// STEP 2 - HASH CALCULATION:
// └── phash = computePHash(imageBuffer)
//
// STEP 3 - DATABASE LOOKUP:
// SELECT * FROM visual_hashes 
// WHERE guild_id IN (0, ctx.chat.id)
//   AND type = 'ban'
//
// STEP 4 - HAMMING COMPARISON:
// FOR EACH known_hash:
//   distance = hammingDistance(phash, known_hash.phash)
//   IF distance <= visual_hamming_threshold:
//     RETURN match (known_hash)
//
// STEP 5 - SAFELIST CHECK:
// └── Se match trovato, verifica non sia in type='safe'
//
// STEP 6 - ACTION:
// └── Se match confermato → applica visual_action

// ----------------------------------------------------------------------------
// 4. ACTION HANDLER
// ----------------------------------------------------------------------------
//
// action === 'auto_ban':
// ├── ctx.deleteMessage()
// ├── ctx.banChatMember()
// ├── Decrementa global_flux di 100
// └── Log con riferimento all'hash matchato
//
// action === 'delete':
// ├── ctx.deleteMessage()
// └── Log silenzioso
//
// action === 'report':
// ├── NON eliminare
// └── Invia a staff:
//     ┌────────────────────────────────────────────┐
//     │ 🧬 **VISUAL MATCH DETECTED**               │
//     │                                            │
//     │ 👤 Utente: @username (Tier 0)             │
//     │ 📊 Match: 98% (Hamming: 2)                │
//     │ 📁 Categoria: SCAM                        │
//     │                                            │
//     │ 🖼️ [Immagine postata]                     │
//     │ 🔗 Hash: a1b2c3d4e5f6...                  │
//     └────────────────────────────────────────────┘
//     [ 🔨 Ban ] [ 🗑️ Delete ] [ ✅ Safe (Whitelist) ]
//
// BUTTON "SAFE (Whitelist)":
// └── Aggiunge hash a type='safe'
// └── Previene future false positive

// ----------------------------------------------------------------------------
// 5. ADD TO DATABASE - /visualban
// ----------------------------------------------------------------------------
//
// COMANDO: /visualban (reply a immagine)
// PERMESSI: Admin del gruppo
//
// FLUSSO:
// 1. Admin risponde a messaggio con immagine
// 2. Bot scarica immagine
// 3. Calcola pHash
// 4. Salva in visual_hashes con type='ban'
// 5. Opzionale: [ 🌐 Proponi Globale ] per IntelNetwork
// 6. Conferma: "✅ Immagine aggiunta al database visivo"
//
// COMANDO: /visualsafe (reply a immagine)
// └── Come sopra ma type='safe' (whitelist)

// ----------------------------------------------------------------------------
// 6. CONFIGURATION UI - /visualconfig
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ 🧬 **CONFIGURAZIONE VISUAL IMMUNE**        │
// │                                            │
// │ Stato: ✅ Attivo                           │
// │ Hash nel database: 234 (189 globali)      │
// │ Match oggi: 7                              │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ 🧬 Sistema: ON ] [ 🌐 Sync Globale: ON ]
// [ 👮 Azione: Delete ▼ ]
// [ 🎯 Soglia Hamming: 5 ◀▶ ]
// [ 🔓 Tier Bypass: 3 ]
// [ 📊 Statistiche ] [ 📜 Lista Hash ]
// [ 💾 Salva ] [ ❌ Chiudi ]

// ----------------------------------------------------------------------------
// 7. PERFORMANCE
// ----------------------------------------------------------------------------
//
// OTTIMIZZAZIONI:
// ├── Cache hash in memoria (Map)
// ├── Pre-filter per primi 8 bit (bucket)
// ├── Lazy load hash globali
// └── Batch insert per sync
//
// LIMITI:
// ├── Max 10,000 hash per gruppo
// ├── Max 100,000 hash globali
// └── Immagini > 10MB skip

