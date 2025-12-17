// TODO: IMPLEMENTATION PLAN - VISUAL IMMUNE SYSTEM
//
// 1. DATA MODEL (SQLite Table: 'visual_hashes')
//    - `phash`: String.
//    - `type`: 'ban' | 'safe'.
//
// 2. LOGIC
//    - Match found in DB (Hamming < 5).
//    - Fetch `immune_action` from Guild Config.
//
// 3. CONFIGURABLE ACTION
//    - 'auto_ban': Ban User + Delete.
//    - 'delete': Delete Message only.
//    - 'report': Log to Staff Channel "Visual Match Detected".
//      - Buttons: [ 🔨 Ban ] [ 🗑️ Delete ].
//
// 4. CONFIGURATION UI (`/visualconfig`)
//    - [ 🧬 Global DB: ON/OFF ]
//    - [ 👮 Action: Report/Delete/Auto-Ban ].
