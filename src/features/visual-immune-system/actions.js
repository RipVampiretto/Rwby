const { safeDelete, safeBan } = require('../../utils/error-handlers');
const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');

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
        await db.query("UPDATE visual_hashes SET match_count = match_count + 1 WHERE id = $1", [match.id]);
    } catch (e) { }

    if (action === 'delete') {
        await safeDelete(ctx, 'visual-immune');
    }
    else if (action === 'ban') {
        await safeDelete(ctx, 'visual-immune');
        const banned = await safeBan(ctx, user.id, 'visual-immune');

        if (banned) {
            await userReputation.modifyFlux(db, user.id, ctx.chat.id, -100, 'visual_ban');

            if (superAdmin.forwardBanToParliament) {
                const dist = calculateDistance(currentHash, match.phash);
                const flux = await userReputation.getLocalFlux(db, user.id, ctx.chat.id);

                await superAdmin.forwardBanToParliament(ctx.api, db, {
                    user: user,
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: `Visual Ban: ${match.category} (Dist: ${dist})`,
                    evidence: `Hash: ${currentHash}`,
                    flux: flux
                });
            }

            logParams.eventType = 'ban';
            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
        }
    }
    else if (action === 'report_only') {
        await staffCoordination.reviewQueue(ctx.api, db, {
            guildId: ctx.chat.id,
            source: 'Visual-Immune',
            user: user,
            reason: `Match: ${match.category}`,
            messageId: ctx.message.message_id,
            content: `[Image Match ID ${match.id}]`
        });
    }
}

function calculateDistance(h1, h2) {
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
