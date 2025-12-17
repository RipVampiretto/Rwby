// TODO: IMPLEMENTATION PLAN - NSFW MONITOR
//
// 1. DATA MODEL (SQLite Table: 'guild_config')
//    - `nsfw_enabled`: Boolean.
//    - `nsfw_action`: 'delete' | 'ban' | 'report'.
//
// 2. LOGIC
//    - Score > 0.85 -> Violation.
//    - Apply `nsfw_action`.
//
// 3. ACTION HANDLER
//    - 'report':
//      -blur image (if possible) or just send "NSFW Detected" text to Staff Channel.
//      - Buttons: [ 🔨 Ban ] [ 🗑️ Delete ] [ ✅ Safe ].
//
// 4. CONFIGURATION UI (`/nsfwconfig`)
//    - [ 🔞 Filter: ON/OFF ]
//    - [ 👮 Action: Report/Ban/Delete ].
