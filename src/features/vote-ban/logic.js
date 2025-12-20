function createVote(db, params) {
    const { target, chat, initiator, reason, required, expires, voters } = params;
    const insertResult = db.getDb().prepare(`INSERT INTO active_votes (target_user_id, target_username, chat_id, initiated_by, reason, required_votes, expires_at, created_at, votes_yes, voters) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        target.id, target.username || target.first_name, chat.id, initiator.id, reason, required, expires, new Date().toISOString(),
        1, JSON.stringify(voters)
    );
    return insertResult.lastInsertRowid;
}

function getVote(db, voteId) {
    return db.getDb().prepare("SELECT * FROM active_votes WHERE vote_id = ?").get(voteId);
}

function getActiveVoteForUser(db, chatId, userId) {
    return db.getDb().prepare("SELECT * FROM active_votes WHERE chat_id = ? AND target_user_id = ? AND status = 'active'").get(chatId, userId);
}

function getExpiredVotes(db) {
    const now = new Date();
    return db.getDb().prepare("SELECT * FROM active_votes WHERE status = 'active'").all().filter(v => new Date(v.expires_at) < now);
    // Note: SQL filtering is generally better but this matches original somewhat or improves strictly speaking.
    // Original: db.getDb().prepare("SELECT * FROM active_votes WHERE status = 'active'").all(); then loop check.
    // I will stick to JS filter for compatibility if time zones are tricky, but SQL `expires_at < CURRENT_TIMESTAMP` relies on consistent timezone. 
    // Given previous modules iterate, let's just return all active then JS filter in actions if we want to be safe, OR just return all active and let caller filter.
    // Actually, let's mimic original behavior: `getExpiredVotes` implies we filter here.
}

function getAllActiveVotes(db) {
    return db.getDb().prepare("SELECT * FROM active_votes WHERE status = 'active'").all();
}

function updateVote(db, voteId, yes, no, voters) {
    db.getDb().prepare("UPDATE active_votes SET votes_yes = ?, votes_no = ?, voters = ? WHERE vote_id = ?")
        .run(yes, no, JSON.stringify(voters), voteId);
}

function setPollMessageId(db, voteId, messageId) {
    db.getDb().prepare("UPDATE active_votes SET poll_message_id = ? WHERE vote_id = ?").run(messageId, voteId);
}

function closeVote(db, voteId, status) {
    db.getDb().prepare("UPDATE active_votes SET status = ? WHERE vote_id = ?").run(status, voteId);
}

module.exports = {
    createVote,
    getVote,
    getActiveVoteForUser,
    getExpiredVotes,
    getAllActiveVotes,
    updateVote,
    setPollMessageId,
    closeVote
};
