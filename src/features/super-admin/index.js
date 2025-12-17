// TODO: Implement Super Admin System (The "Parliament")
// 1. Configuration:
//    - Define `SUPER_ADMIN_IDS` (Hardcoded array of User IDs who have ultimate control).
//
// 2. Global Setup Commands (Super Admin Only):
//    - `/setgstaff`: Initializes the "Parliament" Group.
//      - Creates Topics: "Global Reports", "Proposals", "Appeals", "System Status".
//    - `/setglog`: Sets the channel for GLOBAL ban logs (evidence + verdict).
//
// 3. Hierarchy Logic:
//    - Super Admins act as the "Supreme Court".
//    - They receive "bills" (Proposals/Reports) from Groups.
//    - They execute "decrees" (Global Bans/Unbans).
//
// 4. Management Commands:
//    - `/approve <report_id>`: Occurs in the Parliament Group. Confirms a Global Ban proposed by a local group.
//    - `/reject <report_id>`: Denies the ban proposal.
//    - `/settrust <group_id> <score>`: Manually adjusts the credibility of a Country (Group).
//    - `/gban <user_id> [reason]`: Direct executive order ban (bypasses voting).
