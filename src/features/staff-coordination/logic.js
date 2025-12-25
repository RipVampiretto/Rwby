const logger = require('../../middlewares/logger');
const actionLog = require('../action-log');
const i18n = require('../../i18n');
const ui = require('./ui');
const wizard = require('./wizard');
const { updateGuildConfig } = require('../../database/repos/guild');

async function handleCallback(ctx, db) {
    const data = ctx.callbackQuery.data;

    // Wizard Prompts
    if (data === 'stf_wizard:group') {
        wizard.startSession(ctx.from.id, ctx.chat.id, ctx.callbackQuery.message.message_id, 'set_staff_group');
        return ui.sendWizardPrompt(ctx, 'set_staff_group');
    }

    if (data === 'stf_wizard:channel') {
        wizard.startSession(ctx.from.id, ctx.chat.id, ctx.callbackQuery.message.message_id, 'set_log_channel');
        return ui.sendWizardPrompt(ctx, 'set_log_channel');
    }

    // Deletion Actions
    if (data === 'stf_del:group') {
        const lang = await i18n.getLanguage(ctx.chat.id);
        const t = (key, params) => i18n.t(lang, key, params);

        await updateGuildConfig(ctx.chat.id, { staff_group_id: null });

        // Refresh UI
        await ui.sendConfigUI(ctx, db, true, true);
        return ctx.answerCallbackQuery(t('staff.wizard.group_deleted'));
    }

    if (data === 'stf_del:channel') {
        const lang = await i18n.getLanguage(ctx.chat.id);
        const t = (key, params) => i18n.t(lang, key, params);

        await updateGuildConfig(ctx.chat.id, { log_channel_id: null });

        // Refresh UI
        await ui.sendConfigUI(ctx, db, true, true);
        return ctx.answerCallbackQuery(t('staff.wizard.channel_deleted'));
    }

    // Cancel Action
    if (data === 'stf_cancel') {
        wizard.stopSession(ctx.from.id, ctx.chat.id);
        return ui.sendConfigUI(ctx, db, true, true);
    }
}

async function reviewQueue(bot, db, params) {
    if (!db) {
        logger.error('[staff-coordination] DB not initialized in reviewQueue');
        return false;
    }

    const config = await db.getGuildConfig(params.guildId);
    if (!config || !config.staff_group_id) {
        logger.debug(`[staff-coordination] No staff group set for guild ${params.guildId} - report_only disabled`);
        return false;
    }

    let threadId = null;
    if (config.staff_topics) {
        try {
            const topics =
                typeof config.staff_topics === 'string' ? JSON.parse(config.staff_topics) : config.staff_topics;
            threadId = topics.reports;
        } catch (e) {}
    }

    const { source, user, reason, messageId, content } = params;

    const keyboard = {
        inline_keyboard: [
            [
                { text: '🔨 Ban', callback_data: `staff_ban:${user.id}:${params.guildId}` },
                { text: '🗑️ Delete', callback_data: `staff_del:${params.guildId}:${messageId}` }
            ],
            [
                { text: '✅ Ignora', callback_data: 'staff_ign' },
                { text: '🔍 Profilo', url: `tg://user?id=${user.id}` }
            ]
        ]
    };

    const text =
        `📥 <b>REVIEW REQUEST</b>\n` +
        `🔧 Source: ${source}\n` +
        `👤 Utente: <a href="tg://user?id=${user.id}">${user.first_name}</a> [<code>${user.id}</code>]\n` +
        `📝 Reason: ${reason}\n\n` +
        `💬 Content: "${content ? content.substring(0, 100) : 'N/A'}"`;

    if (bot) {
        await bot.api.sendMessage(config.staff_group_id, text, {
            message_thread_id: threadId,
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
        return true;
    } else {
        logger.error('[staff-coordination] Bot instance not available in reviewQueue');
        return false;
    }
}

async function addNote(db, ctx, targetId, noteText, staffGroupId) {
    await db.query(
        `
        INSERT INTO staff_notes (user_id, staff_group_id, note_text, created_by)
        VALUES ($1, $2, $3, $4)
    `,
        [targetId, staffGroupId, noteText, ctx.from.id]
    );
}

async function getNotes(db, targetId, staffGroupId) {
    return await db.queryAll(
        `
        SELECT * FROM staff_notes 
        WHERE user_id = $1 AND staff_group_id = $2
        ORDER BY created_at DESC 
        LIMIT 10
    `,
        [targetId, staffGroupId]
    );
}

async function setStaffGroup(db, ctx, bot, staffId) {
    const testMsg = await bot.api.sendMessage(staffId, '✅ Test connessione Staff Group riuscito.');
    await bot.api.deleteMessage(staffId, testMsg.message_id);

    await db.updateGuildConfig(ctx.chat.id, { staff_group_id: staffId });
}

async function handleStaffAction(ctx, bot, action, data) {
    if (action === 'ban') {
        const parts = data.split(':');
        const targetUserId = parts[1];
        const originalGuildId = parts[2];

        await ctx.answerCallbackQuery('🚫 Eseguendo Ban...');

        try {
            await bot.api.banChatMember(originalGuildId, targetUserId);
            await ctx.editMessageCaption({
                caption: ctx.callbackQuery.message.caption + '\n\n✅ <b>BANNED by ' + ctx.from.first_name + '</b>'
            });
        } catch (e) {
            logger.error(`[staff-coordination] Ban failed: ${e.message}`);
            await ctx.editMessageCaption({
                caption: ctx.callbackQuery.message.caption + '\n\n❌ <b>Ban fallito: ' + e.message + '</b>'
            });
        }

        if (actionLog.getLogEvent()) {
            actionLog.getLogEvent()({
                guildId: originalGuildId,
                eventType: 'staff_ban',
                targetUser: { id: targetUserId, first_name: 'User' },
                executorModule: `Staff: ${ctx.from.first_name}`,
                reason: 'Approved from review queue',
                isGlobal: true
            });
        }
    } else if (action === 'dismiss') {
        await ctx.answerCallbackQuery('✅ Ignorato');
        await ctx.deleteMessage();

        if (actionLog.getLogEvent()) {
            actionLog.getLogEvent()({
                guildId: ctx.chat.id,
                eventType: 'staff_dismiss',
                targetUser: { id: 0, first_name: 'Unknown' },
                executorModule: `Staff: ${ctx.from.first_name}`,
                reason: 'Dismissed from review queue',
                isGlobal: false
            });
        }
    } else if (action === 'delete') {
        const parts = data.split(':');
        if (parts.length >= 3) {
            const origChatId = parts[1];
            const msgId = parts[2];
            try {
                await ctx.api.deleteMessage(origChatId, msgId);
                const lang = await i18n.getLanguage(ctx.chat.id);
                await ctx.answerCallbackQuery(i18n.t(lang, 'common.logs.message_deleted'));
                await ctx.editMessageCaption({
                    caption: ctx.callbackQuery.message.caption + '\n\n✅ <b>DELETED by Staff</b>'
                });

                if (actionLog.getLogEvent()) {
                    actionLog.getLogEvent()({
                        guildId: origChatId,
                        eventType: 'staff_delete',
                        targetUser: { id: 0, first_name: 'Unknown' },
                        executorModule: `Staff: ${ctx.from.first_name}`,
                        reason: 'Deleted from review queue',
                        isGlobal: false
                    });
                }
            } catch (e) {
                await ctx.answerCallbackQuery('❌ Errore eliminazione: ' + e.message);
            }
        }
    }
}

module.exports = {
    reviewQueue,
    addNote,
    getNotes,
    setStaffGroup,
    handleStaffAction,
    handleCallback
};
