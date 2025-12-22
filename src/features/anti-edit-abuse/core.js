const { safeDelete, safeBan } = require('../../utils/error-handlers');
const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');
const snapshots = require('./snapshots');
const detection = require('./detection');

let db = null;

function init(database) {
    db = database;
    snapshots.init(database);
}

async function processEdit(ctx, config) {
    const editedMsg = ctx.editedMessage;

    // Retrieve snapshot
    const snapshot = snapshots.getSnapshot(editedMsg.message_id, editedMsg.chat.id);

    if (!snapshot) return; // No baseline

    const originalText = snapshot.original_text || '';
    const newText = editedMsg.text || '';
    const originalHasLink = snapshot.original_has_link === 1;
    const newHasLink = /(https?:\/\/[^\s]+)/.test(newText);

    // Check A: Link Injection
    if (!originalHasLink && newHasLink) {
        await executeAction(ctx, config.edit_link_injection_action || 'ban', 'Link Injection', originalText, newText);
        return;
    }

    // Check B: Similarity - but allow legitimate additions
    // Skip if very short
    if (originalText.length > 5 && newText.length > 5) {
        // Allow if the original text is preserved at the start (append case)
        // e.g., "ciao" -> "ciao, come stai?" is OK
        const normalizedOriginal = originalText.toLowerCase().trim();
        const normalizedNew = newText.toLowerCase().trim();

        // Check if it's just an append (original preserved at start)
        if (normalizedNew.startsWith(normalizedOriginal)) {
            return; // Legitimate append, skip
        }

        // Check if original content is preserved somewhere (prepend case)
        if (normalizedNew.endsWith(normalizedOriginal)) {
            return; // Legitimate prepend, skip
        }

        // Check if original is contained in new (middle insertion)
        if (normalizedNew.includes(normalizedOriginal) && normalizedNew.length < normalizedOriginal.length * 3) {
            return; // Legitimate addition, skip
        }

        // Now check similarity for actual replacements
        const sim = detection.similarity(originalText, newText);
        const threshold = config.edit_similarity_threshold || 0.5;
        if (sim < threshold) {
            await executeAction(
                ctx,
                config.edit_abuse_action || 'delete',
                `Low Similarity (${Math.round(sim * 100)}%)`,
                originalText,
                newText
            );
            return;
        }
    }
}

async function executeAction(ctx, action, reason, original, current) {
    const user = ctx.from; // edited_message.from
    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'edit_abuse',
        targetUser: user,
        executorAdmin: null,
        reason: `${reason}`,
        isGlobal: action === 'ban'
    };

    if (action === 'delete') {
        await safeDelete(ctx, 'anti-edit-abuse');
    } else if (action === 'ban') {
        await safeDelete(ctx, 'anti-edit-abuse');
        const banned = await safeBan(ctx, user.id, 'anti-edit-abuse');

        if (banned) {
            userReputation.modifyFlux(user.id, ctx.chat.id, -100, 'edit_ban');

            if (superAdmin.forwardBanToParliament) {
                superAdmin.forwardBanToParliament({
                    user: user,
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: `Edit Abuse: ${reason}`,
                    evidence: `BEFORE:\n${original}\n\nAFTER:\n${current}`,
                    flux: userReputation.getLocalFlux(user.id, ctx.chat.id)
                });
            }
            logParams.eventType = 'ban';
            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
        }
    } else if (action === 'report_only') {
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Edit-Abuse',
            user: user,
            reason: `${reason}`,
            messageId: ctx.editedMessage.message_id,
            content: `BEFORE: ${original}\nAFTER: ${current}`
        });
    }
}

module.exports = {
    init,
    processEdit
};
