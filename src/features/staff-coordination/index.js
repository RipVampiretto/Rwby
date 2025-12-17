// TODO: Implement Staff Coordination (Dual Layer)
// 1. Local Command: `/setstaff`
//    - run by Group Admins.
//    - Creates Local Topics: "General Chat", "Local Reports", "Warn Logs".
//    - Configures the group as a "Country" in the network.
//
// 2. Global Command: `/setgstaff` (Super Admin Only)
//    - defined in `super-admin/index.js`, but this module handles the topic creation logic.
//    - Creates Parliament Topics: "Global Proposals", "Appeals", "Network Status".
//
// 3. Inter-Group Communication:
//    - Ensure Local Reports stay Local.
//    - Ensure Global Reports (from `/greport`) are forwarded to the Parliament Group.
//
// 4. Internal Notes:
//    - `/note <user_id>` -> Saves note locally.
//    - `/gnote <user_id>` -> Saves note globally (visible to Super Admins).
