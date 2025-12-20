const logger = require('../../middlewares/logger');
const adminLogger = require('../admin-logger');
const { safeDelete } = require('../../utils/error-handlers');

async function forwardToParliament(bot, db, params) {
    if (!bot) return logger.error("[super-admin] Bot instance missing in forwardToParliament");

    // params: { guildId, source, user, flux, reason, evidence, messageId }
    try {
        const globalConfig = db.getDb().prepare("SELECT * FROM global_config WHERE id = 1 OR id = (SELECT id FROM global_config LIMIT 1)").get();
        if (!globalConfig || !globalConfig.parliament_group_id) return; // No parliament set

        let topicId = null;
        if (globalConfig.global_topics) {
            try {
                const topics = JSON.parse(globalConfig.global_topics);
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

        // Attempt to auto-extract domain for the button if evidence contains link
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

        // Add to pending deletions (24h)
        const deleteAfter = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        db.getDb().prepare(`
            INSERT INTO pending_deletions (message_id, chat_id, created_at, delete_after)
            VALUES (?, ?, ?, ?)
        `).run(sentMsg.message_id, globalConfig.parliament_group_id, new Date().toISOString(), deleteAfter);

        // Also add logic to delete this message if "Skip" is pressed (handled in callbacks)

    } catch (e) {
        logger.error(`[super-admin] Forward error: ${e.message}`);
    }
}

async function sendGlobalLog(bot, db, event) {
    // event: { guildId, eventType, executor, target, reason, details }
    try {
        const globalConfig = db.getDb().prepare("SELECT * FROM global_config WHERE id = 1 OR id = (SELECT id FROM global_config LIMIT 1)").get();
        if (!globalConfig || !globalConfig.global_log_channel) return;

        let threadId = null;
        if (globalConfig.global_topics && globalConfig.parliament_group_id === globalConfig.global_log_channel) {
            try {
                const topics = JSON.parse(globalConfig.global_topics);
                // Map event types to specific topics if possible
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

        // Attempt to send, if fail (e.g. topic closed), try without topic
        try {
            await bot.api.sendMessage(globalConfig.global_log_channel, text, {
                message_thread_id: threadId,
                parse_mode: 'Markdown'
            });
        } catch (e) {
            // Fallback if threadId invalid
            if (threadId) {
                await bot.api.sendMessage(globalConfig.global_log_channel, text, { parse_mode: 'Markdown' });
            }
        }

    } catch (e) {
        // silent fail for logs to avoid loop
    }
}

async function executeGlobalBan(ctx, db, bot, userId) {
    try {
        // 1. Mark user as globally banned in DB
        // This usually implies updating `users` table `is_banned_global = 1`
        // Ensure column exists or use a dedicated table. The `users` table schema in `index.js` mentions `is_banned_global`.

        db.getDb().prepare("UPDATE users SET is_banned_global = 1 WHERE id = ?").run(userId);

        await ctx.answerCallbackQuery("✅ Global Ban Recorded");
        await ctx.editMessageCaption({
            caption: ctx.callbackQuery.message.caption + "\n\n🌍 **GLOBALLY BANNED by " + ctx.from.first_name + "**"
        });

        // 2. Propagate to all trusted guilds (Tier 1+)
        // This would require iterating over guilds and calling banChatMember.
        // For safety/rate-limits, we might just mark it and let the `visual-immune-system` or similar pick it up, 
        // OR we do a best-effort immediate ban loop.

        const guilds = db.getDb().prepare("SELECT id FROM guild_config").all();
        let count = 0;
        for (const g of guilds) {
            try {
                await bot.api.banChatMember(g.id, userId);
                count++;
            } catch (e) { }
        }

        await ctx.reply(`🌍 Global Ban propagato a ${count} gruppi.`);

    } catch (e) {
        logger.error(`[super-admin] Global Ban Error: ${e.message}`);
        await ctx.reply("❌ Error executing global ban: " + e.message);
    }
}


function cleanupPendingDeletions(db, bot) {
    try {
        const now = new Date().toISOString();
        const pending = db.getDb().prepare("SELECT * FROM pending_deletions WHERE delete_after < ?").all(now);

        for (const p of pending) {
            safeDelete(bot, p.chat_id, p.message_id);
            db.getDb().prepare("DELETE FROM pending_deletions WHERE message_id = ?").run(p.message_id);
        }
    } catch (e) {
        logger.error(`[super-admin] Cleanup error: ${e.message}`);
    }
}

async function setupParliament(db, ctx, bot) {
    // Create topics if Forum
    let topics = {};
    if (ctx.chat.is_forum) {
        // Core Topics
        const bans = await ctx.createForumTopic("🔨 Bans");
        const bills = await ctx.createForumTopic("📜 Bills");
        const logs = await ctx.createForumTopic("📋 Logs");

        // New Requested Topics
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

    // Update Global Config (upsert logic)
    db.getDb().prepare(`
        INSERT INTO global_config (id, parliament_group_id, global_topics) 
        VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET 
            parliament_group_id = ?, 
            global_topics = ?
    `).run(ctx.chat.id, JSON.stringify(topics), ctx.chat.id, JSON.stringify(topics));

    return topics;
}

function getStats(db) {
    return db.getDb().prepare(`
        SELECT 
            (SELECT COUNT(*) FROM users WHERE is_banned_global = 1) as global_bans,
            (SELECT COUNT(*) FROM bills WHERE status = 'pending') as pending_bills,
            (SELECT COUNT(*) FROM guild_trust) as guilds,
            (SELECT AVG(trust_score) FROM guild_trust) as avg_trust
    `).get();
}

module.exports = {
    forwardToParliament,
    sendGlobalLog,
    executeGlobalBan,
    cleanupPendingDeletions,
    setupParliament,
    getStats
};
