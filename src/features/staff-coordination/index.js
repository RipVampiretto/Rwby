// TODO: IMPLEMENTATION PLAN - STAFF COORDINATION
//
// 1. DATA MODEL (SQLite Table: 'guild_config')
//    - `staff_group_id`: Integer.
//    - `topics`: JSON { general_tid, reports_tid, logs_tid }.
//
// 2. SETUP (Admin Only)
//    - Command: `/setstaff`.
//    - Creates Topics if Forum.
//    - Updates `guild_config`.
//
// 3. REVIEW QUEUE ROUTER
//    - Receives reports from other modules (`AntiSpam`, `AI`, etc).
//    - Formats uniform "Review Request" message.
//    - Buttons: [ ✅ Allow ] [ 🔨 Ban ] [ 🗑️ Delete ].
//
// 4. GLOBAL NOTE SYSTEM
//    - Command: `/gnote <user> <text>`.
//    - Action:
//      - Store in DB `global_notes`.
//      - Call `IntelNetwork.broadcastNote(userId, noteText)`.
