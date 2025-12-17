// TODO: IMPLEMENTATION PLAN - ADMIN LOGGER
//
// 1. DATA MODEL (SQLite Table: 'guild_config')
//    - `log_channel_id`: Integer.
//    - `log_events`: JSON Array ['ban', 'kick', 'mute', 'warn', 'deleted_msg'].
//
// 2. LOGGING ENGINE
//    - Function: `logEvent(guildId, eventType, user, admin, reason, proof)`.
//    - Logic:
//      - Fetch `log_channel_id` from DB.
//      - If null, return.
//      - Format Message: standardized Embed-like text.
//        "🔴 **BAN EXECUTED**\n👤 User: [Link]\n🛡️ Admin: [Link]\n📝 Reason: [Reason]\n🔢 ID: [UserID]"
//      - Attachment: Valid Proof (Screenshot/Forward) if passed.
//
// 3. DUAL SCOPE ROUTING
//    - If `eventType` contains 'GLOBAL_ACTION':
//      - Route to `SuperAdmin.global_log_channel`.
//    - If `eventType` is LOCAL:
//      - Route to `guild_config.log_channel_id`.
//
// 4. CONFIGURATION UI
//    - Command: `/logconfig` (Admin).
//    - UI: Inline Keyboard.
//      - [ 🔴 Bans: ON ] [ 🟡 Mutes: ON ] [ 🗑️ Deletes: OFF ].
//      - [ 📂 Set Channel ].
