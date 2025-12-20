const { safeDelete, safeBan } = require('../../utils/error-handlers');
const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');
const logic = require('./logic'); // Circular dependency warning, but logic doesn't require actions at top level so might be ok. 
// Actually logic calls executeAction. So actions cannot require logic if logic requires actions.
// Solution: Pass hammingDistance as utility or duplicate it. logic exports hammingDistance.
// Actions needs logic only for hammingDistance in log message. 
// Let's defer require or move hammingDistance to utils if needed. 
// For now, logic exports hammingDistance and it is pure function.

async function executeAction(ctx, db, action, match, currentHash) {
    const user = ctx.from;
    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'visual_ban',
        targetUser: user,
        executorAdmin: null,
        reason: `Visual Match (${match.category})`,
        isGlobal: (action === 'ban')
    };

    try {
        db.getDb().prepare("UPDATE visual_hashes SET match_count = match_count + 1 WHERE id = ?").run(match.id);
    } catch (e) { }

    if (action === 'delete') {
        await safeDelete(ctx, 'visual-immune');
    }
    else if (action === 'ban') {
        await safeDelete(ctx, 'visual-immune');
        const banned = await safeBan(ctx, user.id, 'visual-immune');

        if (banned) {
            userReputation.modifyFlux(user.id, ctx.chat.id, -100, 'visual_ban');

            if (superAdmin.forwardBanToParliament) {
                // We need hamming distance here.
                // We can import the pure function easily or just calculate it?
                // logic.js exports it.
                const dist = calculateDistance(currentHash, match.phash);

                superAdmin.forwardBanToParliament({
                    user: user,
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: `Visual Ban: ${match.category} (Dist: ${dist})`,
                    evidence: `Hash: ${currentHash}`,
                    flux: userReputation.getLocalFlux(user.id, ctx.chat.id)
                });
            }

            logParams.eventType = 'ban';
            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
        }
    }
    else if (action === 'report_only') {
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Visual-Immune',
            user: user,
            reason: `Match: ${match.category}`,
            messageId: ctx.message.message_id,
            content: `[Image Match ID ${match.id}]`
        });
    }
}

// Duplicated for simplicity to avoid circular require with logic.js if necessary, 
// OR simpler: assume logic.js is loaded. logic.js requires actions.js. actions.js requires logic.js?
// Cycle: logic -> actions -> logic.
// Logic uses actions.executeAction. Actions uses logic.hammingDistance (optional, just for logging).
// I will implement helper here to break cycle.
function calculateDistance(h1, h2) {
    let count = 0;
    let dist = 0;
    for (let i = 0; i < h1.length; i++) {
        let v1 = parseInt(h1[i], 16);
        let v2 = parseInt(h2[i], 16);
        let val = v1 ^ v2;
        while (val) {
            dist++;
            val &= val - 1;
        }
    }
    return dist;
}

module.exports = {
    executeAction
};
