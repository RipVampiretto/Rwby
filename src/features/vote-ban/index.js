// TODO: Implement Vote Ban System
// 1. Trigger: Listen for messages mentioning '@admin' (or a specific command) sent as a REPLY to another user.
// 2. Action: Bot sends a message with inline buttons: "Vote to Ban [User]" (Yes/No).
// 3. Counting Logic:
//    - Store votes in memory or DB (prevent duplicate votes by same user).
//    - Configurable threshold 'N' (e.g., 5 votes needed).
// 4. Admin Override:
//    - Check if the voter is an Admin.
//    - If Admin clicks 'Yes' -> Ban immediately.
//    - If Admin clicks 'No' -> Cancel vote immediately and delete bot message.
// 5. Execution:
//    - If 'Yes' votes >= N -> Ban user and delete original message.
//    - (Optional) Cool-down period to prevent abuse.
