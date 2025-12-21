const logger = require('../../middlewares/logger');
const adminLogger = require('../admin-logger');

async function reviewQueue(bot, db, params) {
    if (!db) {
        logger.error("[staff-coordination] DB not initialized in reviewQueue");
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
            const topics = typeof config.staff_topics === 'string'
                ? JSON.parse(config.staff_topics)
                : config.staff_topics;
            threadId = topics.reports;
        } catch (e) { }
    }

    const { source, user, reason, messageId, content } = params;

    const keyboard = {
        inline_keyboard: [
            [
                { text: "🔨 Ban", callback_data: `staff_ban:${user.id}:${params.guildId}` },
                { text: "🗑️ Delete", callback_data: `staff_del:${params.guildId}:${messageId}` }
            ],
            [
                { text: "✅ Ignora", callback_data: "staff_ign" },
                { text: "🔍 Profilo", url: `tg://user?id=${user.id}` }
            ]
        ]
    };

    const text = `📥 **REVIEW REQUEST**\n` +
        `🔧 Source: ${source}\n` +
        `👤 Utente: [${user.first_name}](tg://user?id=${user.id}) (\`${user.id}\`)\n` +
        `📝 Reason: ${reason}\n\n` +
        `💬 Content: "${content ? content.substring(0, 100) : 'N/A'}"`;

    if (bot) {
        await bot.api.sendMessage(config.staff_group_id, text, {
            message_thread_id: threadId,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
        return true;
    } else {
        logger.error("[staff-coordination] Bot instance not available in reviewQueue");
        return false;
    }
}

async function addNote(db, ctx, targetId, noteText, staffGroupId) {
    await db.query(`
        INSERT INTO staff_notes (user_id, staff_group_id, note_text, created_by)
        VALUES ($1, $2, $3, $4)
    `, [targetId, staffGroupId, noteText, ctx.from.id]);
}

async function getNotes(db, targetId, staffGroupId) {
    return await db.queryAll(`
        SELECT * FROM staff_notes 
        WHERE user_id = $1 AND staff_group_id = $2
        ORDER BY created_at DESC 
        LIMIT 10
    `, [targetId, staffGroupId]);
}

async function setStaffGroup(db, ctx, bot, staffId) {
    const testMsg = await bot.api.sendMessage(staffId, "✅ Test connessione Staff Group riuscito.");
    await bot.api.deleteMessage(staffId, testMsg.message_id);

    await db.updateGuildConfig(ctx.chat.id, { staff_group_id: staffId });
}

async function handleStaffAction(ctx, bot, action, data) {
    if (action === 'ban') {
        const parts = data.split(":");
        const targetUserId = parts[1];
        const originalGuildId = parts[2];

        await ctx.answerCallbackQuery("🚫 Eseguendo Ban...");

        try {
            await bot.api.banChatMember(originalGuildId, targetUserId);
            await ctx.editMessageCaption({
                caption: ctx.callbackQuery.message.caption + "\n\n✅ **BANNED by " + ctx.from.first_name + "**"
            });
        } catch (e) {
            logger.error(`[staff-coordination] Ban failed: ${e.message}`);
            await ctx.editMessageCaption({
                caption: ctx.callbackQuery.message.caption + "\n\n❌ **Ban fallito: " + e.message + "**"
            });
        }

        if (adminLogger.getLogEvent()) {
            adminLogger.getLogEvent()({
                guildId: originalGuildId,
                eventType: 'staff_ban',
                targetUser: { id: targetUserId, first_name: 'User' },
                executorModule: `Staff: ${ctx.from.first_name}`,
                reason: 'Approved from review queue',
                isGlobal: true
            });
        }
    } else if (action === 'dismiss') {
        await ctx.answerCallbackQuery("✅ Ignorato");
        await ctx.deleteMessage();

        if (adminLogger.getLogEvent()) {
            adminLogger.getLogEvent()({
                guildId: ctx.chat.id,
                eventType: 'staff_dismiss',
                targetUser: { id: 0, first_name: 'Unknown' },
                executorModule: `Staff: ${ctx.from.first_name}`,
                reason: 'Dismissed from review queue',
                isGlobal: false
            });
        }
    } else if (action === 'delete') {
        const parts = data.split(":");
        if (parts.length >= 3) {
            const origChatId = parts[1];
            const msgId = parts[2];
            try {
                await ctx.api.deleteMessage(origChatId, msgId);
                await ctx.answerCallbackQuery("🗑️ Messaggio eliminato");
                await ctx.editMessageCaption({
                    caption: ctx.callbackQuery.message.caption + "\n\n✅ **DELETED by Staff**"
                });

                if (adminLogger.getLogEvent()) {
                    adminLogger.getLogEvent()({
                        guildId: origChatId,
                        eventType: 'staff_delete',
                        targetUser: { id: 0, first_name: 'Unknown' },
                        executorModule: `Staff: ${ctx.from.first_name}`,
                        reason: 'Deleted from review queue',
                        isGlobal: false
                    });
                }
            } catch (e) {
                await ctx.answerCallbackQuery("❌ Errore eliminazione: " + e.message);
            }
        }
    }
}

module.exports = {
    reviewQueue,
    addNote,
    getNotes,
    setStaffGroup,
    handleStaffAction
};
