// TODO: IMPLEMENTATION PLAN - LANGUAGE MONITOR
//
// 1. DATA MODEL (SQLite Table: 'guild_config')
//    - `allowed_languages`: JSON Array ['it', 'en'].
//    - `lang_action`: 'delete' | 'warn' | 'report' | 'nothing'.
//
// 2. LOGIC
//    - Lib: `franc`.
//    - Analyze text -> Return ISO code.
//    - If code NOT in `allowed_languages`:
//      - Apply `lang_action`.
//
// 3. CONFIGURABLE ACTIONS
//    - 'delete': Delete message.
//    - 'warn': Delete + Warn User.
//    - 'report': Log to Staff Channel [ 🗑️ Delete ] [ ✅ Allow ].
//    - 'nothing': Just label it (maybe for translation).
//
// 4. TRANSLATION LAYER
//    - If `lang` != Allowed, but user is Tier 2:
//      - Translate -> Check -> Allow.
//
// 5. CONFIGURATION UI (`/langconfig`)
//    - [ 🏳️ Allowed: IT, EN ]
//    - [ 👮 Action: Report/Delete/Warn ]
