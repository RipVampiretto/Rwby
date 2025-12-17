// TODO: IMPLEMENTATION PLAN - STAFF COORDINATION
//
// 1. DATA MODEL (SQLite Table: 'guild_settings')
//    - `staff_group_id`: Integer (ID of the private staff group/forum).
//    - `topics`: JSON { general_tid, reports_tid, logs_tid }.
//
// 2. SETUP (Admin Only)
//    - Command: `/setstaff`.
//    - Action:
//      - Converts current group to Forum (if possible) or requires a Forum group.
//      - Creates Topics: "General", "Review Queue", "System Logs".
//      - Updates DB.
//
// 3. THE "REVIEW QUEUE" (Local Governance)
//    - Connected to `AntiSpam` / `VisualImmune` / `UserReputation`.
//    - When a user is "Flagged" but not Banned (Ambiguous case):
//      - Bot posts in "Review Queue".
//      - content: "Suspect: [User] | trigger: Rapid Join".
//      - Buttons: [ 🔨 Ban ] [ 🔊 Mute 1h ] [ ✅ Pardon ].
//      - Action: Updates SQLite `user_stats` based on decision.
//
// 4. GLOBAL NOTE SYSTEM
//    - Command: `/note <user_id> <text>` (Local).
//      - Stored in `local_notes` table. Visible only to this guild's staff.
//    - Command: `/gnote <user_id> <text>` (Global - Tier 3+ only).
//      - Stored in `global_notes` table (Synced via Intel Network).
//      - Visible to all Partner groups.
