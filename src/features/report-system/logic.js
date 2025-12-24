async function createVote(db, params) {
    const { target, chat, initiator, reason, required, expires, voters, actionType = 'ban' } = params;
    const result = await db.query(
        `INSERT INTO active_votes (target_user_id, target_username, chat_id, initiated_by, reason, required_votes, expires_at, created_at, votes_yes, voters, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, 'active') RETURNING vote_id`,
        [
            target.id,
            target.username || target.first_name,
            chat.id,
            initiator.id,
            `[${actionType.toUpperCase()}] ${reason}`,
            required,
            expires,
            1,
            JSON.stringify(voters)
        ]
    );
    return result.rows[0].vote_id;
}

async function getVote(db, voteId) {
    return await db.queryOne('SELECT * FROM active_votes WHERE vote_id = $1', [voteId]);
}

async function getActiveVoteForUser(db, chatId, userId) {
    return await db.queryOne(
        "SELECT * FROM active_votes WHERE chat_id = $1 AND target_user_id = $2 AND status = 'active'",
        [chatId, userId]
    );
}

async function getExpiredVotes(db) {
    const now = new Date();
    const votes = await db.queryAll("SELECT * FROM active_votes WHERE status = 'active'");
    return votes.filter(v => new Date(v.expires_at) < now);
}

async function getAllActiveVotes(db) {
    return await db.queryAll("SELECT * FROM active_votes WHERE status = 'active'");
}

async function updateVote(db, voteId, updates) {
    const setClauses = [];
    const values = [];
    let idx = 1;

    if (updates.votes_yes !== undefined) {
        setClauses.push(`votes_yes = $${idx++}`);
        values.push(updates.votes_yes);
    }
    if (updates.votes_no !== undefined) {
        setClauses.push(`votes_no = $${idx++}`);
        values.push(updates.votes_no);
    }
    if (updates.voters !== undefined) {
        setClauses.push(`voters = $${idx++}`);
        values.push(JSON.stringify(updates.voters));
    }
    if (updates.status !== undefined) {
        setClauses.push(`status = $${idx++}`);
        values.push(updates.status);
    }

    if (setClauses.length === 0) return;

    values.push(voteId);
    await db.query(`UPDATE active_votes SET ${setClauses.join(', ')} WHERE vote_id = $${idx}`, values);
}

async function setPollMessageId(db, voteId, messageId) {
    await db.query('UPDATE active_votes SET poll_message_id = $1 WHERE vote_id = $2', [messageId, voteId]);
}

async function closeVote(db, voteId, status) {
    await db.query('UPDATE active_votes SET status = $1 WHERE vote_id = $2', [status, voteId]);
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
