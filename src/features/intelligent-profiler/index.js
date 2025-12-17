// TODO: IMPLEMENTATION PLAN - INTELLIGENT PROFILER
// NOTE: Integrated with 'ANTI-SPAM' user tracking.
//
// 1. LOGIC (On Message)
//    - If Tier 0 "Novizio" (< 100 Flux):
//      - Content Check (Link/Forward/Scam).
//      - If Violation -> Apply `new_user_action`.
//
// 2. CONFIGURABLE ACTION
//    - 'delete': Delete msg.
//    - 'warn': Delete + Warn.
//    - 'kick': Kick user (soft ban).
//    - 'ban': Ban user.
//    - 'report': Send to Staff Queue for review.
//
// 3. CONFIGURATION (`/profilerconfig`)
//    - [ 🛡️ Check Links: ON/OFF ]
//    - [ 🛡️ Check Forwards: ON/OFF ]
//    - [ 👮 Violation Action: Report/Delete/Kick/Ban ].
