// TODO: Implement Admin Logger (Dual Scope)
// 1. Configuration:
//    - `local_log_channel`: Set by `/setlog` (Group Admin).
//    - `global_log_channel`: Set by `/setglog` (Super Admin).
//
// 2. Logging Logic `logAction(scope, type, details)`:
//    - If Scope = LOCAL:
//      - Send to `local_log_channel` of that specific group.
//    - If Scope = GLOBAL:
//      - Send to `global_log_channel`.
//      - Format: "#GLOBAL_BAN | Country: [Group Name] | Target: [User]" + Evidence (Forward/Screenshot).
//
// 3. Evidence Handling:
//    - Global bans MUST include evidence (forwarded message or attachment) logged in the global channel for transparency.
