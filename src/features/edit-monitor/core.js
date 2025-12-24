const { safeDelete } = require('../../utils/error-handlers');
const staffCoordination = require('../staff-coordination');
const actionLog = require('../action-log');
const superAdmin = require('../super-admin');
const snapshots = require('./snapshots');
const detection = require('./detection');
const i18n = require('../../i18n');

let db = null;

function init(database) {
    db = database;
    snapshots.init(database);
}

async function processEdit(ctx, config) {
    const editedMsg = ctx.editedMessage;

    // Retrieve snapshot
    const snapshot = await snapshots.getSnapshot(editedMsg.message_id, editedMsg.chat.id);

    if (!snapshot) return; // No baseline

    // Grace period check: skip if message was created recently
    const gracePeriod = config.edit_grace_period ?? 0; // 0 = no grace period
    if (gracePeriod > 0) {
        const createdAt = new Date(snapshot.created_at).getTime();
        const now = Date.now();
        const minutesSinceCreation = (now - createdAt) / 60000;
        if (minutesSinceCreation < gracePeriod) {
            return; // Within grace period, allow edits
        }
    }

    const originalText = snapshot.original_text || '';
    const newText = editedMsg.text || '';
    const originalHasLink = snapshot.original_has_link === true || snapshot.original_has_link === 1;

    // Use Telegram entities to detect links (catches hidden text_links too)
    const entities = editedMsg.entities || editedMsg.caption_entities || [];
    let newHasLink = entities.some(e => e.type === 'url' || e.type === 'text_link');
    // Fallback regex check
    if (!newHasLink) {
        newHasLink = /(https?:\/\/[^\s]+)/.test(newText);
    }

    // Check A: Link Injection
    if (!originalHasLink && newHasLink) {
        await executeAction(ctx, config, 'link_injection', originalText, newText);
        return;
    }

    // Check B: Similarity (fixed at 75%)
    // Skip if very short
    if (originalText.length > 5 && newText.length > 5) {
        const normalizedOriginal = originalText.toLowerCase().trim();
        const normalizedNew = newText.toLowerCase().trim();

        // Allow legitimate appends/prepends
        if (normalizedNew.startsWith(normalizedOriginal)) return;
        if (normalizedNew.endsWith(normalizedOriginal)) return;
        if (normalizedNew.includes(normalizedOriginal) && normalizedNew.length < normalizedOriginal.length * 3) return;

        // Fixed 75% threshold
        const sim = detection.similarity(originalText, newText);
        if (sim < 0.75) {
            await executeAction(ctx, config, 'low_similarity', originalText, newText);
            return;
        }
    }
}

async function executeAction(ctx, config, reason, original, current) {
    const action = config.edit_action || 'delete';
    const user = ctx.from;
    const lang = await i18n.getLanguage(ctx.chat.id);

    // Parse log events
    let logEvents = {};
    if (config.log_events) {
        if (typeof config.log_events === 'string') {
            try {
                logEvents = JSON.parse(config.log_events);
            } catch (e) { }
        } else if (typeof config.log_events === 'object') {
            logEvents = config.log_events;
        }
    }

    const reasonText =
        reason === 'link_injection' ? i18n.t(lang, 'antiedit.reason_link') : i18n.t(lang, 'antiedit.reason_similarity');

    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'edit_abuse',
        targetUser: user,
        reason: reasonText,
        isGlobal: false
    };

    if (action === 'delete') {
        // Forward to Parliament BEFORE deleting
        if (superAdmin.forwardToParliament) {
            await superAdmin.forwardToParliament({
                type: 'edit_abuse',
                user: user,
                guildName: ctx.chat.title,
                guildId: ctx.chat.id,
                reason: reasonText,
                evidence: `PRIMA:\n${original.substring(0, 200)}\n\nDOPO:\n${current.substring(0, 200)}`
            });
        }

        await safeDelete(ctx, 'anti-edit-abuse');

        // Send warning and auto-delete after 1 minute
        try {
            const userName = user.username
                ? `@${user.username}`
                : `<a href="tg://user?id=${user.id}">${user.first_name}</a>`;
            const warningMsg = i18n.t(lang, 'antiedit.warning', { user: userName });
            const warning = await ctx.reply(warningMsg, { parse_mode: 'HTML' });
            setTimeout(async () => {
                try {
                    await ctx.api.deleteMessage(ctx.chat.id, warning.message_id);
                } catch (e) { }
            }, 60000);
        } catch (e) { }

        // Log if enabled
        if (logEvents['edit_delete'] && actionLog.getLogEvent()) {
            actionLog.getLogEvent()(logParams);
        }
    } else if (action === 'report_only') {
        const sent = await staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Anti-Edit',
            user: user,
            reason: reasonText,
            messageId: ctx.editedMessage.message_id,
            content: `PRIMA: ${original.substring(0, 200)}\nDOPO: ${current.substring(0, 200)}`
        });

        if (sent && logEvents['edit_report'] && actionLog.getLogEvent()) {
            logParams.eventType = 'edit_report';
            actionLog.getLogEvent()(logParams);
        }
    }
}

module.exports = {
    init,
    processEdit
};
