const logger = require('../../middlewares/logger');
const actionLog = require('../action-log');
const { safeDelete } = require('../../utils/error-handlers');
const i18n = require('../../i18n');
const { queueBanNotification } = require('../global-blacklist/actions');

async function forwardToParliament(bot, db, params) {
    if (!bot) return logger.error('[super-admin] Bot instance missing in forwardToParliament');

    try {
        const globalConfig = await db.queryOne('SELECT * FROM global_config WHERE id = 1');
        if (!globalConfig || !globalConfig.parliament_group_id) return;

        // Select topic based on type
        let topicId = null;
        if (globalConfig.global_topics) {
            try {
                const topics =
                    typeof globalConfig.global_topics === 'string'
                        ? JSON.parse(globalConfig.global_topics)
                        : globalConfig.global_topics;

                // Route to correct topic
                if (params.topic) {
                    topicId = topics[params.topic];
                } else if (params.type === 'link_unknown' || params.type === 'link_blacklist') {
                    topicId = topics.link_checks;
                } else if (params.type === 'keyword' || params.type === 'modal_pattern') {
                    topicId = topics.reports || topics.bans;
                } else {
                    topicId = topics.bans;
                }
            } catch (e) { }
        }

        // Build keyboard based on type
        let keyboard = { inline_keyboard: [] };

        if (params.type === 'link_unknown') {
            // Unknown link - option to whitelist or blacklist
            const domain = params.evidence?.match(/(https?:\/\/[^\s]+)/)?.[0];
            let domainHost = '';
            try {
                domainHost = new URL(domain || '').hostname;
            } catch (e) { }

            keyboard.inline_keyboard = [
                [
                    { text: '✅ Whitelist', callback_data: `wl_domain:${domainHost}` },
                    { text: '🚫 Blacklist', callback_data: `bl_domain:${domainHost}` }
                ],
                [{ text: '❌ Ignora', callback_data: 'parl_dismiss' }]
            ];
        } else if (params.type === 'link_blacklist' || params.type === 'keyword') {
            // Known violation - option to gban user
            const lang = await i18n.getLanguage(globalConfig.parliament_group_id);
            keyboard.inline_keyboard = [
                [
                    { text: i18n.t(lang, 'common.logs.global_ban_user'), callback_data: `gban:${params.user.id}` },
                    { text: i18n.t(lang, 'common.logs.local_only'), callback_data: 'parl_dismiss' }
                ]
            ];
        } else {
            // Default ban forwarding (for backward compat)
            const lang = await i18n.getLanguage(globalConfig.parliament_group_id);
            keyboard.inline_keyboard = [
                [
                    { text: i18n.t(lang, 'common.logs.global_ban'), callback_data: `gban:${params.user.id}` },
                    { text: i18n.t(lang, 'common.logs.local_only'), callback_data: 'parl_dismiss' }
                ]
            ];
        }

        // Build message based on type
        let text = '';
        const userLink = `<a href="tg://user?id=${params.user?.id || 0}">${params.user?.first_name || 'Unknown'}</a>`;
        const lang = await i18n.getLanguage(globalConfig.parliament_group_id);
        const t = key => i18n.t(lang, key);

        if (params.type === 'link_unknown') {
            text =
                `${t('common.logs.unknown_link_title')}\n\n` +
                `${t('common.logs.group')}: ${params.guildName}\n` +
                `${t('common.logs.user')}: ${userLink} [<code>${params.user?.id}</code>]\n` +
                `${t('common.logs.link')}: ${params.evidence}\n\n` +
                `${t('common.logs.add_to_list_question')}`;
        } else if (params.type === 'link_blacklist') {
            text =
                `${t('common.logs.blacklisted_link_title')}\n\n` +
                `${t('common.logs.group')}: ${params.guildName}\n` +
                `${t('common.logs.user')}: ${userLink} [<code>${params.user?.id}</code>]\n` +
                `${t('common.logs.reason')}: ${params.reason}\n` +
                `${t('common.logs.link')}: ${params.evidence}\n\n` +
                `${t('common.logs.global_ban_question')}`;
        } else if (params.type === 'keyword') {
            text =
                `${t('common.logs.keyword_title')}\n\n` +
                `${t('common.logs.group')}: ${params.guildName}\n` +
                `${t('common.logs.user')}: ${userLink} [<code>${params.user?.id}</code>]\n` +
                `${t('common.logs.reason')}: ${params.reason}\n` +
                `${t('common.logs.text')}: "${params.evidence?.substring(0, 100)}"\n\n` +
                `${t('common.logs.global_ban_question')}`;
        } else if (params.type === 'mention_scam' || params.type === 'mention_gbanned') {
            // Mention filter detection
            const title =
                params.type === 'mention_gbanned'
                    ? '🚫 <b>GBANNED USER MENTIONED</b>'
                    : '👤 <b>SUSPICIOUS MENTION DETECTED</b>';
            text =
                `${title}\n\n` +
                `${t('common.logs.group')}: ${params.guildName}\n` +
                `${t('common.logs.user')}: ${userLink} [<code>${params.user?.id}</code>]\n` +
                `${t('common.logs.reason')}: ${params.reason}\n` +
                `${t('common.logs.evidence')}: "${params.evidence?.substring(0, 500)}"\n\n` +
                `${t('common.logs.global_ban_question')}`;
        } else if (params.type === 'modal_pattern') {
            // Pattern detection from spam-patterns module
            text =
                `🎭 <b>PATTERN DETECTED</b>\n\n` +
                `${t('common.logs.group')}: ${params.guildName}\n` +
                `${t('common.logs.user')}: ${userLink} [<code>${params.user?.id}</code>]\n` +
                `${t('common.logs.reason')}: ${params.reason}\n` +
                `📊 Similarity: ${params.similarity}%\n` +
                `${t('common.logs.evidence')}: "${params.evidence?.substring(0, 300)}"\n\n` +
                `${t('common.logs.global_ban_question')}`;
        } else {
            // Default format (backward compat)
            text =
                `${t('common.logs.ban_executed_title')}\n\n` +
                `${t('common.logs.group')}: <code>${params.guildId}</code>\n` +
                `${t('common.logs.user')}: ${userLink} [<code>${params.user?.id}</code>]\n` +
                `${t('common.logs.flux')}: ${params.flux || 'N/A'}\n` +
                `${t('common.logs.reason')}: ${params.reason}\n` +
                `${t('common.logs.evidence')}: "${params.evidence}"`;
        }

        await bot.api.sendMessage(globalConfig.parliament_group_id, text, {
            message_thread_id: topicId,
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    } catch (e) {
        logger.error(`[super-admin] Forward error: ${e.message}`);
    }
}

/**
 * Forward media (photo/video) to Parliament with custom caption and keyboard
 */
async function forwardMediaToParliament(bot, db, topic, ctx, caption, customKeyboard = null) {
    if (!bot) return logger.error('[super-admin] Bot instance missing in forwardMediaToParliament');

    try {
        const globalConfig = await db.queryOne('SELECT * FROM global_config WHERE id = 1');
        if (!globalConfig || !globalConfig.parliament_group_id) return;

        // Select topic
        let topicId = null;
        if (globalConfig.global_topics) {
            try {
                const topics =
                    typeof globalConfig.global_topics === 'string'
                        ? JSON.parse(globalConfig.global_topics)
                        : globalConfig.global_topics;
                topicId = topics[topic] || topics.reports || topics.bans;
            } catch (e) { }
        }

        const keyboard = customKeyboard ? { inline_keyboard: customKeyboard } : null;

        // Forward based on media type
        const msg = ctx.message;
        const options = {
            message_thread_id: topicId,
            caption: caption,
            parse_mode: 'HTML',
            ...(keyboard && { reply_markup: keyboard })
        };

        if (msg.photo) {
            const photo = msg.photo[msg.photo.length - 1];
            await bot.api.sendPhoto(globalConfig.parliament_group_id, photo.file_id, options);
        } else if (msg.video) {
            await bot.api.sendVideo(globalConfig.parliament_group_id, msg.video.file_id, options);
        } else if (msg.animation) {
            await bot.api.sendAnimation(globalConfig.parliament_group_id, msg.animation.file_id, options);
        } else if (msg.sticker) {
            // Stickers can't have caption, send as two messages
            await bot.api.sendSticker(globalConfig.parliament_group_id, msg.sticker.file_id, {
                message_thread_id: topicId
            });
            await bot.api.sendMessage(globalConfig.parliament_group_id, caption, {
                message_thread_id: topicId,
                parse_mode: 'HTML',
                ...(keyboard && { reply_markup: keyboard })
            });
        } else if (msg.document) {
            await bot.api.sendDocument(globalConfig.parliament_group_id, msg.document.file_id, options);
        }
    } catch (e) {
        logger.error(`[super-admin] ForwardMedia error: ${e.message}`);
    }
}

/**
 * Forward album to Parliament with all violating media
 * @param {object} bot - Bot instance
 * @param {object} db - Database instance
 * @param {string} topic - Topic key
 * @param {Array} violations - Array of {ctx, reason, type}
 * @param {object} info - {groupTitle, user, reason, count}
 */
async function forwardAlbumToParliament(bot, db, topic, violations, info) {
    if (!bot || !violations || violations.length === 0) return;

    try {
        const globalConfig = await db.queryOne('SELECT * FROM global_config WHERE id = 1');
        if (!globalConfig || !globalConfig.parliament_group_id) return;

        // Select topic
        let topicId = null;
        if (globalConfig.global_topics) {
            try {
                const topics =
                    typeof globalConfig.global_topics === 'string'
                        ? JSON.parse(globalConfig.global_topics)
                        : globalConfig.global_topics;
                topicId = topics[topic] || topics.image_spam || topics.bans;
            } catch (e) { }
        }

        // Build media group
        const lang = await i18n.getLanguage(globalConfig.parliament_group_id);
        const t = key => i18n.t(lang, key);
        const mediaItems = violations
            .map((v, idx) => {
                const msg = v.ctx.message;
                let item = null;
                if (msg.photo) {
                    const photo = msg.photo[msg.photo.length - 1];
                    item = { type: 'photo', media: photo.file_id };
                } else if (msg.video) {
                    item = { type: 'video', media: msg.video.file_id };
                } else if (msg.animation) {
                    item = { type: 'document', media: msg.animation.file_id };
                } else if (msg.document) {
                    item = { type: 'document', media: msg.document.file_id };
                }
                // Caption on first item
                if (item && idx === 0) {
                    item.caption =
                        `🖼️ <b>NSFW ALBUM</b>\n\n` +
                        `${t('common.logs.group')}: ${info.groupTitle}\n` +
                        `${t('common.logs.user')}: <a href="tg://user?id=${info.user.id}">${info.user.first_name}</a> [<code>${info.user.id}</code>]\n` +
                        `📁 Media: ${info.count}\n` +
                        `📝 Categories: ${info.reason}`;
                    item.parse_mode = 'HTML';
                }
                return item;
            })
            .filter(Boolean);

        if (mediaItems.length === 0) return;

        // Send album
        await bot.api.sendMediaGroup(globalConfig.parliament_group_id, mediaItems, {
            message_thread_id: topicId
        });

        // Send keyboard separately (can't be attached to media group)
        await bot.api.sendMessage(globalConfig.parliament_group_id, `⚖️ Actions for ${info.user.first_name}:`, {
            message_thread_id: topicId,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: i18n.t(lang, 'common.logs.global_ban_user'), callback_data: `gban:${info.user.id}` },
                        { text: '✅ Ignore', callback_data: 'parl_dismiss' }
                    ]
                ]
            }
        });
    } catch (e) {
        logger.error(`[super-admin] ForwardAlbum error: ${e.message}`);
    }
}

async function sendGlobalLog(bot, db, event) {
    try {
        const globalConfig = await db.queryOne('SELECT * FROM global_config WHERE id = 1');
        if (!globalConfig || !globalConfig.parliament_group_id) return;

        let threadId = null;
        if (globalConfig.global_topics) {
            try {
                const topics =
                    typeof globalConfig.global_topics === 'string'
                        ? JSON.parse(globalConfig.global_topics)
                        : globalConfig.global_topics;
                if (event.eventType === 'bot_join' || event.eventType === 'bot_leave') threadId = topics.add_group;
                else if (event.eventType === 'user_join' || event.eventType === 'user_leave')
                    threadId = topics.join_logs;
                else if (event.eventType === 'image_spam_check') threadId = topics.image_spam;
                else if (event.eventType === 'link_check') threadId = topics.link_checks;
                else threadId = topics.logs;
            } catch (e) { }
        }

        // Build message based on event type
        let text = '';

        if (event.eventType === 'user_join') {
            text = `📥 <b>Nuovo Membro</b>\n\n` + `👤 ${event.target}\n` + `🏠 ${event.details}`;
        } else if (event.eventType === 'user_leave') {
            text = `📤 <b>Membro Uscito</b>\n\n` + `👤 ${event.target}\n` + `🏠 ${event.details}`;
        } else if (event.eventType === 'bot_join') {
            text = `🤖 <b>Bot Aggiunto</b>\n\n` + `🏠 ${event.details}\n` + `🆔 <code>${event.guildId}</code>`;
        } else if (event.eventType === 'bot_leave') {
            text = `👋 <b>Bot Rimosso</b>\n\n` + `🏠 ${event.details}\n` + `🆔 <code>${event.guildId}</code>`;
        } else {
            // Generic format for other events
            text =
                `📋 <b>${event.eventType.toUpperCase()}</b>\n\n` +
                `👤 ${event.target}\n` +
                `🏠 ${event.details || 'N/A'}\n` +
                `📝 ${event.reason}`;
        }

        try {
            await bot.api.sendMessage(globalConfig.parliament_group_id, text, {
                message_thread_id: threadId,
                parse_mode: 'HTML'
            });
        } catch (e) {
            // If topic fails, try without thread
            if (threadId) {
                await bot.api.sendMessage(globalConfig.parliament_group_id, text, { parse_mode: 'HTML' });
            }
        }
    } catch (e) {
        logger.error(`[super-admin] sendGlobalLog error: ${e.message}`);
    }
}

async function executeGlobalBan(ctx, db, bot, userId) {
    try {
        await db.query('UPDATE users SET is_banned_global = TRUE WHERE user_id = $1', [userId]);

        // Update local gban cache
        const detection = require('../global-blacklist/detection');
        detection.addToLocalCache(parseInt(userId));

        await ctx.answerCallbackQuery('✅ Global Ban Recorded');

        // Check if message has caption (media) or text (normal message)
        const message = ctx.callbackQuery.message;
        const banSuffix = `\n\n🌍 <b>GLOBALLY BANNED by ${ctx.from.first_name}</b>`;

        if (message.caption) {
            // Media message with caption
            await ctx.editMessageCaption({
                caption: message.caption + banSuffix,
                parse_mode: 'HTML'
            });
        } else if (message.text) {
            // Text message
            await ctx.editMessageText(message.text + banSuffix, {
                parse_mode: 'HTML'
            });
        }

        // Try to get user info for logging
        let targetUser = { id: userId, first_name: 'Unknown' };
        try {
            const userInfo = await bot.api.getChat(userId);
            targetUser = {
                id: userId,
                first_name: userInfo.first_name || 'Unknown',
                username: userInfo.username
            };
        } catch (e) {
            // User info not available, use default
        }

        // Get all guilds with their config for notification check
        const guilds = await db.queryAll('SELECT guild_id, guild_name FROM guild_config');
        let count = 0;
        for (const g of guilds) {
            try {
                await bot.api.banChatMember(g.guild_id, userId);
                count++;

                // Send notification if blacklist_notify is enabled for this guild
                const config = await db.getGuildConfig(g.guild_id);
                if (config && config.blacklist_notify && config.log_channel_id) {
                    queueBanNotification(
                        config.log_channel_id,
                        targetUser,
                        { id: g.guild_id, title: g.guild_name || `Group ${g.guild_id}` },
                        `Global Ban by ${ctx.from.first_name}`
                    );
                }
            } catch (e) { }
        }

        await ctx.reply(`🌍 Global Ban propagato a ${count} gruppi.`);
    } catch (e) {
        logger.error(`[super-admin] Global Ban Error: ${e.message}`);
        await ctx.reply('❌ Error executing global ban: ' + e.message);
    }
}

async function cleanupPendingDeletions(db, bot) {
    try {
        const now = new Date().toISOString();
        const pending = await db.queryAll('SELECT * FROM pending_deletions WHERE delete_after < $1', [now]);

        for (const p of pending) {
            try {
                await bot.api.deleteMessage(p.chat_id, p.message_id);
            } catch (e) { }
            await db.query('DELETE FROM pending_deletions WHERE id = $1', [p.id]);
        }
    } catch (e) {
        logger.error(`[super-admin] Cleanup error: ${e.message}`);
    }
}

async function setupParliament(db, ctx, bot) {
    let topics = {};
    if (ctx.chat.is_forum) {
        const bans = await ctx.createForumTopic('🔨 Bans');
        const logs = await ctx.createForumTopic('📋 Logs');
        const joinLogs = await ctx.createForumTopic('📥 Join Logs');
        const addGroup = await ctx.createForumTopic('🆕 Add Group');
        const imageSpam = await ctx.createForumTopic('🖼️ Image Spam');
        const linkChecks = await ctx.createForumTopic('🔗 Link Checks');

        topics = {
            bans: bans.message_thread_id,
            logs: logs.message_thread_id,
            join_logs: joinLogs.message_thread_id,
            add_group: addGroup.message_thread_id,
            image_spam: imageSpam.message_thread_id,
            link_checks: linkChecks.message_thread_id
        };
    } else {
        await ctx.reply('⚠️ Ottimizzato per Forum (Topic). Creazione topic saltata.');
    }

    await db.query(
        `
        INSERT INTO global_config (id, parliament_group_id, global_topics) 
        VALUES (1, $1, $2)
        ON CONFLICT(id) DO UPDATE SET 
            parliament_group_id = $1, 
            global_topics = $2
    `,
        [ctx.chat.id, JSON.stringify(topics)]
    );

    return topics;
}

async function getStats(db) {
    return await db.queryOne(`
        SELECT 
            (SELECT COUNT(*) FROM users) as users_count,
            (SELECT COUNT(*) FROM guild_config) as guilds_count,
            
            (SELECT COUNT(*) FROM users WHERE is_banned_global = TRUE) as global_bans,
            
            -- Local Flux Stats
            COALESCE((SELECT AVG(local_flux) FROM user_trust_flux), 0)::numeric as avg_local_flux,
            COALESCE((SELECT SUM(local_flux) FROM user_trust_flux), 0)::numeric as total_local_flux,
            
            -- Global Flux Stats
            COALESCE((SELECT AVG(global_flux) FROM user_global_flux), 0)::numeric as avg_global_flux,
            COALESCE((SELECT SUM(global_flux) FROM user_global_flux), 0)::numeric as total_global_flux,
            
            -- Filter Stats
            (SELECT COUNT(*) FROM link_rules WHERE type = 'domain' AND action = 'allow') as whitelist_count,
            (SELECT COUNT(*) FROM link_rules WHERE type = 'domain' AND action = 'delete') as blacklist_count,
            (SELECT COUNT(*) FROM active_votes WHERE status = 'active') as active_votes
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

/**
 * Notify Parliament about a new group registration
 */
async function notifyNewGroup(bot, db, guildId, guildName) {
    try {
        const globalConfig = await db.queryOne('SELECT * FROM global_config WHERE id = 1');
        if (!globalConfig || !globalConfig.parliament_group_id) return;

        let threadId = null;
        if (globalConfig.global_topics) {
            try {
                const topics =
                    typeof globalConfig.global_topics === 'string'
                        ? JSON.parse(globalConfig.global_topics)
                        : globalConfig.global_topics;
                threadId = topics.add_group;
            } catch (e) { }
        }

        if (!threadId) return;

        const text =
            `🆕 <b>NEW GROUP REGISTERED</b>\n\n` +
            `📛 Name: <b>${guildName}</b>\n` +
            `🆔 ID: <code>${guildId}</code>\n` +
            `📅 Date: ${new Date().toISOString()}`;

        await bot.api.sendMessage(globalConfig.parliament_group_id, text, {
            message_thread_id: threadId,
            parse_mode: 'HTML'
        });
    } catch (e) {
        logger.error(`[super-admin] notifyNewGroup error: ${e.message}`);
    }
}

module.exports = {
    forwardToParliament,
    forwardMediaToParliament,
    forwardAlbumToParliament,
    sendGlobalLog,
    executeGlobalBan,
    cleanupPendingDeletions,
    setupParliament,
    getStats,
    syncGlobalBansToGuild,
    notifyNewGroup
};
