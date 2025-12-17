// ============================================================================
// TODO: IMPLEMENTATION PLAN - VOTE BAN (Community Tribunal)
// ============================================================================
// SCOPO: Moderazione democratica. La community vota per bannare.
// Protezioni anti-abuse e override admin.
// SOLO BAN come azione (niente mute/warn).
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: active_votes
// ├── vote_id: INTEGER PRIMARY KEY
// ├── target_user_id, target_username: INTEGER, TEXT
// ├── chat_id: INTEGER
// ├── poll_message_id: INTEGER
// ├── initiated_by: INTEGER
// ├── reason: TEXT
// ├── votes_yes, votes_no: INTEGER (DEFAULT 0)
// ├── required_votes: INTEGER
// ├── voters: TEXT (JSON Array)
// ├── status: TEXT ('active', 'passed', 'failed', 'cancelled')
// ├── created_at, expires_at: TEXT
//
// TABELLA: guild_config (campi vote-ban)
// ├── voteban_enabled: INTEGER (0/1, DEFAULT 0)
// ├── voteban_threshold: INTEGER (DEFAULT 5)
// ├── voteban_duration_minutes: INTEGER (DEFAULT 30)
// ├── voteban_initiator_tier: INTEGER (DEFAULT 1)
// └── voteban_voter_tier: INTEGER (DEFAULT 0)

// ----------------------------------------------------------------------------
// 2. TRIGGER - /voteban (reply)
// ----------------------------------------------------------------------------
//
// VERIFICA:
// ├── voteban_enabled === true
// ├── Iniziatore ha tier sufficiente
// ├── Target NON è admin
// └── Target NON già sotto votazione

// ----------------------------------------------------------------------------
// 3. VOTING UI
// ----------------------------------------------------------------------------
//
// ┌────────────────────────────────────────────┐
// │ ⚖️ **TRIBUNALE DELLA COMMUNITY**           │
// │ 👤 Accusato: @username                    │
// │ 🗣️ Accusatore: @initiator                │
// │ 📝 Motivo: "Spam"                         │
// │ 📊 Voti: 0/5 | ⏱️ Scade: 30 min           │
// └────────────────────────────────────────────┘
// [ 🟢 Banna (0) ] [ 🔴 Innocente (0) ]
// [ 🛡️ Admin: Forza Ban ] [ 🛡️ Admin: Perdona ]

// ----------------------------------------------------------------------------
// 4. THRESHOLD REACHED → BAN
// ----------------------------------------------------------------------------
//
// QUANDO votes_yes >= required_votes:
// ├── ctx.banChatMember(target)
// ├── **FORWARD A SUPERADMIN**:
// │   ┌────────────────────────────────────────────┐
// │   │ 🔨 **BAN ESEGUITO (Vote Ban)**             │
// │   │ 🏛️ Gruppo: Nome                           │
// │   │ 👤 Target: @username                       │
// │   │ ⚖️ Voti: 5 Sì / 2 No                      │
// │   │ 🗣️ Iniziatore: @accuser                   │
// │   └────────────────────────────────────────────┘
// │   [ 🌍 Global Ban ]
// └── Auto-delete forward dopo 24h

// ----------------------------------------------------------------------------
// 5. ADMIN OVERRIDE
// ----------------------------------------------------------------------------
//
// [ Admin: Forza Ban ] → Ban immediato
// [ Admin: Perdona ] → Chiude votazione, target salvo

// ----------------------------------------------------------------------------
// 6. CONFIGURATION UI - /voteconfig
// ----------------------------------------------------------------------------
//
// KEYBOARD:
// [ ⚖️ Sistema: OFF ]
// [ 📊 Soglia: 5 voti ] [ ⏱️ Durata: 30 min ]
// [ 🏷️ Tier Iniziatore: 1 ] [ 🏷️ Tier Votante: 0 ]
// [ 💾 Salva ] [ ❌ Chiudi ]
