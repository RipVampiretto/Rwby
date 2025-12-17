// TODO: IMPLEMENTATION PLAN - ANTI-EDIT ABUSE
//
// 1. LOGIC (On 'edited_message')
//    - Detect Link Injection or >50% Text Change.
//    - Apply `edit_abuse_action`.
//
// 2. CONFIGURABLE ACTION
//    - 'delete': Delete msg.
//    - 'warn': Delete + Warn.
//    - 'ban': Ban (Aggressive).
//    - 'report': Log to Staff Channel "Suspicious Edit" (Before/After).
//
// 3. CONFIGURATION (`/editconfig`)
//    - [ 🔒 Lock Edits for Tier 0: ON/OFF ]
//    - [ 👮 On Abuse: Report/Delete/Ban ].
