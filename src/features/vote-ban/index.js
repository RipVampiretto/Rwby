// TODO: IMPLEMENTATION PLAN - VOTE BAN
//
// 1. DATA MODEL (SQLite Table: 'active_votes')
//    - `vote_id`: Integer (Unique).
//    - `target_user_id`: Integer.
//    - `chat_id`: Integer.
//    - `msg_id`: Integer (The poll message).
//    - `votes_yes`: Integer.
//    - `votes_no`: Integer.
//    - `required_votes`: Integer (Snapshot of config at start).
//    - `voters`: JSON Array (to prevent double voting).
//
// 2. TRIGGER
//    - Reply with text "@admin" or custom command `/voteban`.
//    - Check: Is target already an Admin? (Immunity).
//
// 3. UI (Inline Keyboard)
//    - Message: "⚖️ **COMMUNITY TRIBUNAL**\nTarget: [User]\nVotes: 0/[N]"
//    - Buttons:
//      - [ 🟢 Yes (Ban) ] (Callback: `vote_yes`)
//      - [ 🔴 No (Innocent) ] (Callback: `vote_no`)
//      - [ 🛡️ Admin Force Ban ] (Visible to all, usable only by Admin).
//      - [ 🛡️ Admin Pardon ] (Usable only by Admin).
//
// 4. LOGIC
//    - On Click: Check if user already voted. Update DB. Update Message UI.
//    - Threshold Reached:
//      - Execute Ban.
//      - Delete Vote Message.
//      - Log to Staff Channel.
//
// 5. CONFIGURATION
//    - `/voteconfig`:
//      - [ 🔢 Threshold: 5/10/20 ]
//      - [ ⏱️ Duration: 30m ] (Auto-close vote if not reached).
