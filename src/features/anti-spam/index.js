// TODO: IMPLEMENTATION PLAN - ANTI-SPAM (Level Progression System)
//
// 1. DATA MODEL (SQLite Table: 'user_active_stats')
//    - `user_id`: Integer.
//    - `guild_id`: Integer.
//    - `msg_count_60s`: Integer (Rolling window count).
//    - `last_msg_content`: String (For duplicate detection).
//    - `last_msg_ts`: Timestamp.
//
// 2. LOGIC: BEHAVIOR ANALYSIS
//    - Middleware runs on EVERY text message.
//    - Update `msg_count_60s`.
//
//    - CHECK 1: VOLUME (Traditional Rate Limit)
//      - If count > Config Limit: Apply `action_volume`.
//    - CHECK 2: REPETITION
//      - If content == `last_msg_content`: Apply `action_repetition`.
//
// 3. CONFIGURABLE ACTIONS
//    - Actions: 'delete', 'warn', 'mute', 'kick', 'ban', 'report_only'.
//    - Default:
//      - Single Violation: 'delete'.
//      - Repeated Violation: 'mute'.
//      - Critical Violation: 'report_only' (Let Staff decide).
//
// 4. AUTOMATED REPORTING
//    - If Action == 'report_only':
//      - Create report in Staff "Review Queue".
//      - "Potential Spam detected. User: [Link]. Trigger: [Volume/Repeat]".
//      - Buttons: [ 🔨 Ban ] [ 🔊 Mute ] [ 🗑️ Delete ] [ ✅ Ignore ].
//
// 5. CONFIGURATION UI (`/spamconfig`)
//    - [ 🛡️ Sensitivity: High/Med/Low ]
//    - [ 👮 On Flood: Delete/Mute/Ban/Report ]
//    - [ 👮 On Repeat: Delete/Mute/Ban/Report ]
