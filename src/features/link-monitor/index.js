// TODO: IMPLEMENTATION PLAN - LINK MONITOR
//
// 1. DATA MODEL (SQLite Table: 'link_rules')
//    - `pattern`: String.
//    - `type`: 'whitelist' | 'blacklist'.
//    - `action`: 'delete' | 'warn' | 'ban' | 'report' (Only for blacklist).
//    - `guild_id`: Integer.
//
// 2. LOGIC
//    - Priority Check:
//      1. Whitelist -> Pass.
//      2. Blacklist -> Apply `action`.
//    - Default Policy (Unknown Link) -> Configurable Action (`unknown_link_action`).
//
// 3. CONFIGURATION UI (`/linkconfig`)
//    - [ 🌐 Global List: ON/OFF ]
//    - [ 👮 On Blacklist Hit: Report/Ban/Delete ]
//    - [ ❓ On Unknown Link: Allow/Report/Delete ] (e.g. for Tier 0 users).
//    - [ ➕ Add Rule ] -> Wizard.
