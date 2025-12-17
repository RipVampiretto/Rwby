// ============================================================================
// TODO: IMPLEMENTATION PLAN - VOTE BAN (Community Tribunal)
// ============================================================================
// SCOPO: Sistema di moderazione democratica. La community può votare per
// bannare utenti problematici. Include protezioni anti-abuse e override admin.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL
// ----------------------------------------------------------------------------
//
// TABELLA: active_votes (votazioni in corso)
// ├── vote_id: INTEGER PRIMARY KEY AUTOINCREMENT
// ├── target_user_id: INTEGER (utente sotto giudizio)
// ├── target_username: TEXT (cache per display)
// ├── chat_id: INTEGER (gruppo dove avviene il voto)
// ├── poll_message_id: INTEGER (ID messaggio con bottoni)
// ├── initiated_by: INTEGER (chi ha avviato la votazione)
// ├── reason: TEXT (motivazione)
// ├── votes_yes: INTEGER (DEFAULT 0)
// ├── votes_no: INTEGER (DEFAULT 0)
// ├── required_votes: INTEGER (snapshot threshold al momento)
// ├── voters: TEXT (JSON Array di user IDs che hanno votato)
// ├── status: TEXT ('active', 'passed', 'failed', 'cancelled')
// ├── created_at: TEXT (ISO timestamp)
// └── expires_at: TEXT (ISO timestamp scadenza)
//
// TABELLA: guild_config (campi vote-ban)
// ├── voteban_enabled: INTEGER (0/1, DEFAULT 0)
// │   └── Disabilitato default (opt-in esplicito)
// ├── voteban_threshold: INTEGER (DEFAULT 5)
// │   └── Numero voti necessari per passare
// ├── voteban_duration_minutes: INTEGER (DEFAULT 30)
// │   └── Durata massima votazione
// ├── voteban_cooldown_minutes: INTEGER (DEFAULT 60)
// │   └── Tempo minimo tra votazioni per stesso utente
// ├── voteban_initiator_tier: INTEGER (DEFAULT 1)
// │   └── Tier minimo per avviare votazione
// └── voteban_voter_tier: INTEGER (DEFAULT 0)
//     └── Tier minimo per votare

// ----------------------------------------------------------------------------
// 2. TRIGGER - Avvio Votazione
// ----------------------------------------------------------------------------
//
// METODO A - Comando:
// COMANDO: /voteban (reply a messaggio)
// PERMESSI: Tier >= voteban_initiator_tier
//
// METODO B - Keyword:
// └── Risposta con "@admin" a messaggio (se abilitato)
//
// FLUSSO AVVIO:
// 1. Verifica voteban_enabled === true
// 2. Verifica iniziatore ha tier sufficiente
// 3. Verifica target NON è admin/owner
// 4. Verifica target NON è già sotto votazione
// 5. Verifica cooldown rispettato
// 6. Crea record in active_votes
// 7. Invia messaggio con poll inline

// ----------------------------------------------------------------------------
// 3. VOTING UI - Inline Keyboard
// ----------------------------------------------------------------------------
//
// FORMATO MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ ⚖️ **TRIBUNALE DELLA COMMUNITY**           │
// │                                            │
// │ 👤 Accusato: @username                    │
// │ 🗣️ Accusatore: @initiator                │
// │ 📝 Motivo: "Spam ripetuto"                │
// │                                            │
// │ 📊 Voti: 0 / 5 necessari                  │
// │ ⏱️ Scade tra: 30 minuti                   │
// │                                            │
// │ ⚠️ Vota responsabilmente. Abusi saranno   │
// │    sanzionati.                             │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ 🟢 Sì - Banna (0) ] [ 🔴 No - Innocente (0) ]
// [ 🛡️ Admin: Forza Ban ] [ 🛡️ Admin: Perdona ]
//
// NOTA: Bottoni admin visibili a tutti ma funzionanti solo per admin

// ----------------------------------------------------------------------------
// 4. VOTING LOGIC
// ----------------------------------------------------------------------------
//
// CALLBACK: vote_yes_X, vote_no_X
//
// FLUSSO:
// 1. Verifica voter ha tier sufficiente
// 2. Verifica voter non ha già votato
// 3. Verifica votazione ancora attiva
// 4. Aggiungi voter a voters array
// 5. Incrementa votes_yes o votes_no
// 6. Aggiorna messaggio con nuovo conteggio
// 7. Check threshold:
//    ├── IF votes_yes >= required_votes: PASS
//    │   └── Esegui ban
//    └── IF votes_no >= required_votes: FAIL
//        └── Chiudi votazione, target salvo
//
// ANTI-ABUSE:
// ├── 1 voto per utente (tracking in voters array)
// ├── Non puoi votare su te stesso
// ├── Non puoi votare se sei l'iniziatore
// └── Tier minimo previene bot voting

// ----------------------------------------------------------------------------
// 5. THRESHOLD REACHED - Esecuzione
// ----------------------------------------------------------------------------
//
// QUANDO votes_yes >= required_votes:
//
// 1. Aggiorna status = 'passed'
// 2. ctx.banChatMember(target_user_id)
// 3. Decrementa local_flux di 100
// 4. Aggiorna messaggio:
//    ┌────────────────────────────────────────────┐
//    │ ⚖️ **VERDETTO: COLPEVOLE**                 │
//    │                                            │
//    │ 👤 @username è stato bannato              │
//    │ 📊 Voti: 5 Sì / 2 No                      │
//    │ ⏱️ Eseguito: 14:45:30                     │
//    └────────────────────────────────────────────┘
// 5. Log a AdminLogger
// 6. Opzionale: proponi global report se grave

// ----------------------------------------------------------------------------
// 6. ADMIN OVERRIDE
// ----------------------------------------------------------------------------
//
// CALLBACK: admin_force_ban_X
// PERMESSI: Solo admin Telegram
//
// FLUSSO:
// 1. Aggiorna status = 'passed'
// 2. Esegui ban immediatamente
// 3. Aggiorna messaggio: "Bannato da Admin"
//
// CALLBACK: admin_pardon_X
// PERMESSI: Solo admin Telegram
//
// FLUSSO:
// 1. Aggiorna status = 'cancelled'
// 2. Target rimane nel gruppo
// 3. Aggiorna messaggio: "Perdonato da Admin"
// 4. Reset cooldown per questo utente

// ----------------------------------------------------------------------------
// 7. EXPIRATION & CLEANUP
// ----------------------------------------------------------------------------
//
// CRONJOB (ogni minuto):
// SELECT * FROM active_votes WHERE status = 'active' AND expires_at < NOW()
//
// PER OGNI votazione scaduta:
// 1. IF votes_yes > votes_no: PASS (maggioranza)
// 2. ELSE: FAIL
// 3. Aggiorna messaggio con risultato
// 4. Elimina record (o mantieni per storico)

// ----------------------------------------------------------------------------
// 8. CONFIGURATION UI - /voteconfig
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ ⚖️ **CONFIGURAZIONE VOTE BAN**             │
// │                                            │
// │ Stato: ❌ Disabilitato                     │
// │ Votazioni totali: 23                       │
// │ Ban eseguiti: 12                           │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ ⚖️ Sistema: OFF ] [ 📊 Soglia: 5 voti ]
// [ ⏱️ Durata: 30 min ] [ 🔄 Cooldown: 60 min ]
// [ 🏷️ Tier Iniziatore: 1 ] [ 🏷️ Tier Votante: 0 ]
// [ 💾 Salva ] [ ❌ Chiudi ]

// ----------------------------------------------------------------------------
// 9. SECURITY CONSIDERATIONS
// ----------------------------------------------------------------------------
//
// RISCHI:
// ├── Mob mentality: gruppo banna utenti innocenti
// ├── Brigading: gruppo esterno coordina voti
// ├── Self-defense: utente crea alt per votare
// └── Abuse: iniziatore spamma votazioni
//
// MITIGAZIONI:
// ├── Admin può sempre override
// ├── Cooldown tra votazioni
// ├── Tier minimo per votare/iniziare
// ├── Votazioni loggata per audit
// └── Opt-in esplicito (disabilitato default)

