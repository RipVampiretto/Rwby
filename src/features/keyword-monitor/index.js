// TODO: IMPLEMENTATION PLAN - KEYWORD MONITOR (Blacklist)
//
// 1. DATA MODEL (SQLite Table: 'word_filters')
//    - `word`: String (Regex compatible).
//    - `action`: 'delete' | 'warn' | 'ban' | 'report'.
//    - `guild_id`: Integer.
//    - `is_regex`: Boolean.
//
// 2. LOGIC
//    - Iterate through filters.
//    - Match found? -> Execute `action` defined for THAT word.
//
// 3. ACTION HANDLER
//    - 'report': Do not delete immediately. Send copy to Staff Channel with "Hit: [Word]".
//      - Buttons: [ 🗑️ Delete ] [ 🔨 Ban ] [ ✅ False Positive ].
//
// 4. CONFIGURATION UI (`/wordconfig`)
//    - [ ➕ Add Word ] -> Wizard:
//      - "Type word/regex"
//      - "Select Action: [Report] [Delete] [Ban]"
//    - [ 📜 View List ]
