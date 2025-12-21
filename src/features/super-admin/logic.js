const logger = require('../../middlewares/logger');
const adminLogger = require('../admin-logger');
const { safeDelete } = require('../../utils/error-handlers');

async function forwardToParliament(bot, db, params) {
    if (!bot) return logger.error("[super-admin] Bot instance missing in forwardToParliament");

    try {
        const globalConfig = await db.queryOne("SELECT * FROM global_config WHERE id = 1");
        if (!globalConfig || !globalConfig.parliament_group_id) return;

        let topicId = null;
        if (globalConfig.global_topics) {
            try {
                const topics = typeof globalConfig.global_topics === 'string'
                    ? JSON.parse(globalConfig.global_topics)
                    : globalConfig.global_topics;
                topicId = topics.bans;
            } catch (e) { }
        }

        const keyboard = {
            inline_keyboard: [
                [
                    { text: "➕ Blacklist Link", callback_data: `bl_link::${params.guildId}:${params.messageId}` },
                    { text: "➕ Blacklist Parola", callback_data: "bl_word" }
                ],
                [
                    { text: "🌍 Global Ban", callback_data: `gban:${params.user.id}` },
                    { text: "✅ Solo Locale", callback_data: `gban_skip:${params.messageId}` }
                ]
            ]
        };

        const linkMatch = params.evidence?.match(/(https?:\/\/[^\s]+)/);
        if (linkMatch) {
            try {
                const url = new URL(linkMatch[0]);
                keyboard.inline_keyboard[0][0].callback_data = `bl_link:${url.hostname}:${params.guildId}:${params.messageId}`;
            } catch (e) { }
        }

        const text = `🔨 **BAN ESEGUITO**\n\n` +
            `🏛️ Gruppo: \`${params.guildId}\`\n` +
            `👤 Utente: [${params.user.first_name}](tg://user?id=${params.user.id}) (\`${params.user.id}\`)\n` +
            `📊 Flux: ${params.flux}\n` +
            `⏰ Ora: ${new Date().toISOString().replace('T', ' ').substring(0, 16)}\n\n` +
            `📝 Motivo: ${params.reason}\n` +
            `💬 Evidence: "${params.evidence}"`;

        const sentMsg = await bot.api.sendMessage(globalConfig.parliament_group_id, text, {
            message_thread_id: topicId,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });

        const deleteAfter = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await db.query(`
            INSERT INTO pending_deletions (message_id, chat_id, created_at, delete_after)
            VALUES ($1, $2, NOW(), $3)
        `, [sentMsg.message_id, globalConfig.parliament_group_id, deleteAfter]);

    } catch (e) {
        logger.error(`[super-admin] Forward error: ${e.message}`);
    }
}

async function sendGlobalLog(bot, db, event) {
    try {
        const globalConfig = await db.queryOne("SELECT * FROM global_config WHERE id = 1");
        if (!globalConfig || !globalConfig.global_log_channel) return;

        let threadId = null;
        if (globalConfig.global_topics && globalConfig.parliament_group_id === globalConfig.global_log_channel) {
            try {
                const topics = typeof globalConfig.global_topics === 'string'
                    ? JSON.parse(globalConfig.global_topics)
                    : globalConfig.global_topics;
                if (event.eventType === 'bot_join' || event.eventType === 'bot_leave') threadId = topics.add_group;
                else if (event.eventType === 'user_join' || event.eventType === 'user_leave') threadId = topics.join_logs;
                else if (event.eventType === 'image_spam_check') threadId = topics.image_spam;
                else if (event.eventType === 'link_check') threadId = topics.link_checks;
                else threadId = topics.logs;
            } catch (e) { }
        }

        const text = `📋 **GLOBAL LOG: ${event.eventType}**\n` +
            `🏛️ Guild: \`${event.guildId}\`\n` +
            `👤 Executor: ${event.executor} | Target: ${event.target}\n` +
            `📝 Reason: ${event.reason}\n` +
            `ℹ️ Details: ${event.details || 'N/A'}`;

        try {
            await bot.api.sendMessage(globalConfig.global_log_channel, text, {
                message_thread_id: threadId,
                parse_mode: 'Markdown'
            });
        } catch (e) {
            if (threadId) {
                await bot.api.sendMessage(globalConfig.global_log_channel, text, { parse_mode: 'Markdown' });
            }
        }

    } catch (e) { }
}

async function executeGlobalBan(ctx, db, bot, userId) {
    try {
        await db.query("UPDATE users SET is_banned_global = TRUE WHERE user_id = $1", [userId]);

        await ctx.answerCallbackQuery("✅ Global Ban Recorded");
        await ctx.editMessageCaption({
            caption: ctx.callbackQuery.message.caption + "\n\n🌍 **GLOBALLY BANNED by " + ctx.from.first_name + "**"
        });

        const guilds = await db.queryAll("SELECT guild_id FROM guild_config");
        let count = 0;
        for (const g of guilds) {
            try {
                await bot.api.banChatMember(g.guild_id, userId);
                count++;
            } catch (e) { }
        }

        await ctx.reply(`🌍 Global Ban propagato a ${count} gruppi.`);

    } catch (e) {
        logger.error(`[super-admin] Global Ban Error: ${e.message}`);
        await ctx.reply("❌ Error executing global ban: " + e.message);
    }
}


async function cleanupPendingDeletions(db, bot) {
    try {
        const now = new Date().toISOString();
        const pending = await db.queryAll("SELECT * FROM pending_deletions WHERE delete_after < $1", [now]);

        for (const p of pending) {
            try {
                await bot.api.deleteMessage(p.chat_id, p.message_id);
            } catch (e) { }
            await db.query("DELETE FROM pending_deletions WHERE id = $1", [p.id]);
        }
    } catch (e) {
        logger.error(`[super-admin] Cleanup error: ${e.message}`);
    }
}

async function setupParliament(db, ctx, bot) {
    let topics = {};
    if (ctx.chat.is_forum) {
        const bans = await ctx.createForumTopic("🔨 Bans");
        const bills = await ctx.createForumTopic("📜 Bills");
        const logs = await ctx.createForumTopic("📋 Logs");
        const joinLogs = await ctx.createForumTopic("📥 Join Logs");
        const addGroup = await ctx.createForumTopic("🆕 Add Group");
        const imageSpam = await ctx.createForumTopic("🖼️ Image Spam");
        const linkChecks = await ctx.createForumTopic("🔗 Link Checks");

        topics = {
            bans: bans.message_thread_id,
            bills: bills.message_thread_id,
            logs: logs.message_thread_id,
            join_logs: joinLogs.message_thread_id,
            add_group: addGroup.message_thread_id,
            image_spam: imageSpam.message_thread_id,
            link_checks: linkChecks.message_thread_id
        };
    } else {
        await ctx.reply("⚠️ Ottimizzato per Forum (Topic). Creazione topic saltata.");
    }

    await db.query(`
        INSERT INTO global_config (id, parliament_group_id, global_topics) 
        VALUES (1, $1, $2)
        ON CONFLICT(id) DO UPDATE SET 
            parliament_group_id = $1, 
            global_topics = $2
    `, [ctx.chat.id, JSON.stringify(topics)]);

    return topics;
}

async function getStats(db) {
    return await db.queryOne(`
        SELECT 
            (SELECT COUNT(*) FROM users WHERE is_banned_global = TRUE) as global_bans,
            (SELECT COUNT(*) FROM bills WHERE status = 'pending') as pending_bills,
            (SELECT COUNT(*) FROM guild_trust) as guilds,
            (SELECT AVG(trust_score) FROM guild_trust) as avg_trust
    `);
}

/**
 * Sync all global bans to a specific guild when they enable gban_sync
 * @param {Bot} bot - Grammy bot instance
 * @param {object} db - Database instance
 * @param {number} guildId - Guild ID to sync to
 * @returns {Promise<{success: number, failed: number}>}
 */
async function syncGlobalBansToGuild(bot, db, guildId) {
    const bannedUsers = await db.getGloballyBannedUsers();
    let success = 0;
    let failed = 0;

    for (const userId of bannedUsers) {
        try {
            await bot.api.banChatMember(guildId, userId);
            success++;
        } catch (e) {
            // User might not be in this chat, or already banned - that's ok
            failed++;
        }
    }

    logger.info(`[super-admin] Synced global bans to guild ${guildId}: ${success} banned, ${failed} failed`);
    return { success, failed };
}

module.exports = {
    forwardToParliament,
    sendGlobalLog,
    executeGlobalBan,
    cleanupPendingDeletions,
    setupParliament,
    getStats,
    syncGlobalBansToGuild
};
