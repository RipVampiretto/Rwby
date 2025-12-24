// ============================================================================
// CAS BAN ACTIONS - Execute bans and send notifications
// ============================================================================

const logger = require('../../middlewares/logger');
const { safeDelete, safeBan } = require('../../utils/error-handlers');

let db = null;
let _botInstance = null;

// Aggregation queue: { logChannelId: { timer, bans: [{user, groups: []}] } }
const BAN_QUEUE = new Map();
const QUEUE_DELAY_MS = 5000; // 5 seconds to aggregate

function init(database, bot) {
    db = database;
    _botInstance = bot;
}

/**
 * Handle a message from a CAS-banned user
 */
async function handleCasBan(ctx) {
    const user = ctx.from;
    logger.info(`[cas-ban] CAS banned user detected: ${user.id} (${user.first_name})`);

    try {
        await safeDelete(ctx, 'cas-ban');
        const banned = await safeBan(ctx, user.id, 'cas-ban');

        if (banned) {
            const config = await db.getGuildConfig(ctx.chat.id);

            // Queue notification if enabled
            if (config.casban_notify && config.log_channel_id) {
                queueBanNotification(config.log_channel_id, user, ctx.chat, 'CAS Ban');
            }

            logger.info(`[cas-ban] Banned user ${user.id} from chat ${ctx.chat.id}`);
        }
    } catch (e) {
        logger.error(`[cas-ban] Failed to handle CAS ban: ${e.message}`);
    }
}

/**
 * Queue a ban notification for aggregation
 */
function queueBanNotification(logChannelId, user, group, reason) {
    if (!BAN_QUEUE.has(logChannelId)) {
        BAN_QUEUE.set(logChannelId, {
            timer: null,
            bans: new Map() // userId -> { user, groups: [], reason }
        });
    }

    const queue = BAN_QUEUE.get(logChannelId);

    // Add or update user in queue
    if (queue.bans.has(user.id)) {
        // User already in queue, add group
        const entry = queue.bans.get(user.id);
        entry.groups.push({
            id: group.id,
            title: group.title || `Chat ${group.id}`
        });
    } else {
        // New user
        queue.bans.set(user.id, {
            user: user,
            reason: reason,
            groups: [{
                id: group.id,
                title: group.title || `Chat ${group.id}`
            }]
        });
    }

    // Reset timer
    if (queue.timer) {
        clearTimeout(queue.timer);
    }

    queue.timer = setTimeout(() => {
        flushBanQueue(logChannelId);
    }, QUEUE_DELAY_MS);
}

/**
 * Flush the ban queue and send aggregated notification
 */
async function flushBanQueue(logChannelId) {
    if (!_botInstance) return;

    const queue = BAN_QUEUE.get(logChannelId);
    if (!queue || queue.bans.size === 0) return;

    try {
        const bans = Array.from(queue.bans.values());
        const botInfo = await _botInstance.api.getMe();

        // Build message in requested format
        let text = `🚷 #BAN\n`;

        // Bot who executed the bans
        const botLink = `[${botInfo.first_name}](tg://user?id=${botInfo.id})`;
        text += `• Di: ${botLink} [${botInfo.id}]\n`;

        // List all banned users
        for (const ban of bans.slice(0, 30)) {
            const userLink = `[${ban.user.first_name || ban.user.username || 'User'}](tg://user?id=${ban.user.id})`;
            text += `• A: ${userLink} [${ban.user.id}]\n`;
        }

        // Collect all unique groups
        const allGroups = new Map();
        for (const ban of bans) {
            for (const group of ban.groups) {
                allGroups.set(group.id, group.title);
            }
        }

        // List groups
        for (const [groupId, groupTitle] of allGroups) {
            text += `- ${groupTitle} ✅ [\`${groupId}\`]\n`;
        }

        // Add hashtags for all user IDs
        const hashtags = bans.slice(0, 30).map(b => `#id${b.user.id}`).join(' ');
        text += hashtags;

        if (bans.length > 30) {
            text += `\n_...e altri ${bans.length - 30} utenti_`;
        }

        await _botInstance.api.sendMessage(logChannelId, text, { parse_mode: 'HTML' });

        logger.info(`[cas-ban] Sent aggregated notification to ${logChannelId}: ${bans.length} users`);
    } catch (e) {
        logger.error(`[cas-ban] Failed to send aggregated notification: ${e.message}`);
    }

    // Clear queue
    BAN_QUEUE.delete(logChannelId);
}

/**
 * Process newly discovered CAS bans - execute global bans and notify Parliament
 */
async function processNewCasBans(newUsers) {
    if (!_botInstance) return;

    logger.info(`[cas-ban] Processing ${newUsers.length} new CAS bans...`);

    // Get all guilds for global ban (async PostgreSQL)
    const guilds = await db.queryAll('SELECT guild_id FROM guild_config WHERE casban_enabled = true');
    let globalBanCount = 0;
    let failedBans = 0;

    const usersToProcess = newUsers.slice(0, 100);

    // Group guilds by log_channel_id for aggregated notifications
    const guildConfigs = await Promise.all(
        guilds.map(g => db.getGuildConfig(g.guild_id))
    );

    for (const user of usersToProcess) {
        for (let i = 0; i < guilds.length; i++) {
            const guildId = guilds[i].guild_id;
            const config = guildConfigs[i];

            try {
                await _botInstance.api.banChatMember(guildId, user.user_id);
                globalBanCount++;

                // Queue notification if enabled
                if (config.casban_notify && config.log_channel_id) {
                    // Create fake user object for notification
                    const fakeUser = { id: user.user_id, first_name: `User ${user.user_id}` };
                    queueBanNotification(config.log_channel_id, fakeUser, { id: guildId, title: `Group ${guildId}` }, 'CAS Sync');
                }
            } catch (e) {
                failedBans++;
            }
        }

        if (usersToProcess.indexOf(user) % 10 === 9) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    logger.info(`[cas-ban] Global bans executed: ${globalBanCount}, failed: ${failedBans}`);
    await notifyParliament(newUsers, globalBanCount, guilds.length);
}

/**
 * Send notification to Parliament group about new CAS bans
 */
async function notifyParliament(newUsers, banCount, guildCount) {
    if (!_botInstance) return;

    try {
        const globalConfig = await db.queryOne('SELECT * FROM global_config WHERE id = 1');
        if (!globalConfig || !globalConfig.parliament_group_id) return;

        let topicId = null;
        if (globalConfig.global_topics) {
            try {
                const topics =
                    typeof globalConfig.global_topics === 'string'
                        ? JSON.parse(globalConfig.global_topics)
                        : globalConfig.global_topics;
                topicId = topics.bans;
            } catch (e) { }
        }

        const processedCount = Math.min(newUsers.length, 100);
        const text =
            `🛡️ **CAS SYNC REPORT**\n\n` +
            `📊 Nuovi ban CAS rilevati: **${newUsers.length.toLocaleString()}**\n` +
            `🌍 Global ban eseguiti: **${banCount}** (su ${guildCount} gruppi)\n` +
            `👥 Utenti processati: ${processedCount}${newUsers.length > 100 ? ' (limite)' : ''}\n` +
            `⏰ Ora: ${new Date().toISOString().replace('T', ' ').substring(0, 16)}\n\n` +
            `ℹ️ I nuovi utenti CAS sono stati bannati automaticamente da tutti i gruppi.`;

        await _botInstance.api.sendMessage(globalConfig.parliament_group_id, text, {
            message_thread_id: topicId,
            parse_mode: 'HTML'
        });

        logger.info('[cas-ban] Parliament notification sent');
    } catch (e) {
        logger.error(`[cas-ban] Failed to notify Parliament: ${e.message}`);
    }
}

module.exports = {
    init,
    handleCasBan,
    processNewCasBans,
    queueBanNotification // Export for use by other modules (gban)
};
