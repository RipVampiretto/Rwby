// ============================================================================
// CAS BAN ACTIONS - Execute bans and send notifications
// ============================================================================

const logger = require('../../middlewares/logger');
const { safeDelete, safeBan } = require('../../utils/error-handlers');
const adminLogger = require('../admin-logger');

let db = null;
let _botInstance = null;

function init(database, bot) {
    db = database;
    _botInstance = bot;
}

/**
 * Handle a message from a CAS-banned user
 * @param {Context} ctx 
 */
async function handleCasBan(ctx) {
    const user = ctx.from;
    logger.info(`[cas-ban] CAS banned user detected: ${user.id} (${user.first_name})`);

    try {
        // 1. Delete the message
        await safeDelete(ctx, 'cas-ban');

        // 2. Ban from group
        const banned = await safeBan(ctx, user.id, 'cas-ban');

        if (banned) {
            // 3. Log to admin-logger
            if (adminLogger.getLogEvent()) {
                adminLogger.getLogEvent()({
                    guildId: ctx.chat.id,
                    eventType: 'ban',
                    targetUser: user,
                    executorAdmin: null, // System ban
                    reason: 'CAS Ban (Combot Anti-Spam)',
                    isGlobal: false
                });
            }

            logger.info(`[cas-ban] Banned user ${user.id} from chat ${ctx.chat.id}`);
        }
    } catch (e) {
        logger.error(`[cas-ban] Failed to handle CAS ban: ${e.message}`);
    }
}

/**
 * Process newly discovered CAS bans - execute global bans and notify Parliament
 * @param {Array<{user_id: number, offenses: number}>} newUsers 
 */
async function processNewCasBans(newUsers) {
    if (!_botInstance) return;

    logger.info(`[cas-ban] Processing ${newUsers.length} new CAS bans...`);

    // Get all guilds for global ban
    const guilds = db.getDb().prepare('SELECT guild_id FROM guild_config').all();
    let globalBanCount = 0;
    let failedBans = 0;

    // Limit global bans to avoid rate limits (process max 100 new users)
    const usersToProcess = newUsers.slice(0, 100);

    for (const user of usersToProcess) {
        for (const guild of guilds) {
            try {
                await _botInstance.api.banChatMember(guild.guild_id, user.user_id);
                globalBanCount++;
            } catch (e) {
                // User might already be banned or not in group - that's fine
                failedBans++;
            }
        }

        // Small delay to avoid rate limits
        if (usersToProcess.indexOf(user) % 10 === 9) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    logger.info(`[cas-ban] Global bans executed: ${globalBanCount}, failed: ${failedBans}`);

    // Send summary to Parliament
    await notifyParliament(newUsers, globalBanCount, guilds.length);
}

/**
 * Send notification to Parliament group about new CAS bans
 */
async function notifyParliament(newUsers, banCount, guildCount) {
    if (!_botInstance) return;

    try {
        const globalConfig = db.getDb().prepare('SELECT * FROM global_config WHERE id = 1').get();
        if (!globalConfig || !globalConfig.parliament_group_id) return;

        // Get topic ID for bans if forum
        let topicId = null;
        if (globalConfig.global_topics) {
            try {
                const topics = JSON.parse(globalConfig.global_topics);
                topicId = topics.bans;
            } catch (e) { }
        }

        const processedCount = Math.min(newUsers.length, 100);
        const text = `🛡️ **CAS SYNC REPORT**\n\n` +
            `📊 Nuovi ban CAS rilevati: **${newUsers.length.toLocaleString()}**\n` +
            `🌍 Global ban eseguiti: **${banCount}** (su ${guildCount} gruppi)\n` +
            `👥 Utenti processati: ${processedCount}${newUsers.length > 100 ? ' (limite)' : ''}\n` +
            `⏰ Ora: ${new Date().toISOString().replace('T', ' ').substring(0, 16)}\n\n` +
            `ℹ️ I nuovi utenti CAS sono stati bannati automaticamente da tutti i gruppi.`;

        await _botInstance.api.sendMessage(globalConfig.parliament_group_id, text, {
            message_thread_id: topicId,
            parse_mode: 'Markdown'
        });

        logger.info('[cas-ban] Parliament notification sent');
    } catch (e) {
        logger.error(`[cas-ban] Failed to notify Parliament: ${e.message}`);
    }
}

module.exports = {
    init,
    handleCasBan,
    processNewCasBans
};
