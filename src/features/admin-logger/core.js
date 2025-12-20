const logger = require('../../middlewares/logger');
const { MODULE_MAP, EMOJI_MAP } = require('./utils');

let db = null;
let _botInstance = null;

/**
 * Initialize core logger
 * @param {object} bot - Bot instance
 * @param {object} database - Database instance
 */
function init(bot, database) {
    _botInstance = bot;
    db = database;
}

/**
 * Log an event
 * @param {object} params - Log parameters
 */
async function logEvent(params) {
    if (!db || !_botInstance) return;

    const { guildId, guildName, eventType, targetUser, executorModule, reason, messageLink, isGlobal } = params;

    // Get Config
    const config = db.getGuildConfig(guildId);
    if (!config) return;

    // Parse log_events
    let logEvents = {};
    if (config.log_events) {
        try {
            const parsed = JSON.parse(config.log_events);
            if (Array.isArray(parsed)) {
                // Migrate old array format -> enable all actions for those types
                parsed.forEach(t => {
                    logEvents[`${t}_delete`] = true;
                    logEvents[`${t}_ban`] = true;
                });
            } else {
                logEvents = parsed;
            }
        } catch (e) { }
    }

    // Check if this specific event is enabled
    if (!logEvents[eventType]) return;

    const moduleName = executorModule || MODULE_MAP[eventType] || 'System';
    const emoji = EMOJI_MAP[eventType] || 'ℹ️';

    // Action type for tag
    let actionType = 'ACTION';
    if (eventType.endsWith('_ban')) actionType = 'BAN';
    else if (eventType.endsWith('_delete')) actionType = 'DELETE';
    else if (eventType.endsWith('_dismiss')) actionType = 'DISMISS';
    const moduleTag = eventType.split('_')[0].toUpperCase();

    // Format Message
    // Get bot info
    let botInfo = { first_name: 'Bot', username: 'bot', id: 0 };
    try {
        botInfo = await _botInstance.api.getMe();
    } catch (e) { }

    const botLink = botInfo.username
        ? `<a href="https://t.me/${botInfo.username}">${botInfo.first_name}</a>`
        : botInfo.first_name;
    const userLink = targetUser?.username
        ? `<a href="https://t.me/${targetUser.username}">${targetUser.first_name}</a>`
        : `<a href="tg://user?id=${targetUser?.id}">${targetUser?.first_name || 'Unknown'}</a>`;

    // Tags
    let tags = params.customTags || [`#${moduleTag}`, `#${actionType}`];
    let text = `${emoji} ${tags.join(' ')}\n`;
    text += `• Di: ${botLink} [${botInfo.id}]\n`;
    text += `• A: ${userLink} [${targetUser?.id}]\n`;
    text += `• Gruppo: ${guildName || config.guild_name || guildId} [${guildId}]\n`;
    text += `• Motivo: ${reason}\n`;
    if (messageLink) {
        text += `• 👀 Vai al messaggio (${messageLink})\n`;
    }
    text += `#id${targetUser?.id}`;

    // Send Local Log
    if (config.log_channel_id) {
        try {
            let targetChatId = config.log_channel_id;
            let messageThreadId = null;

            if (config.staff_group_id && config.staff_topics) {
                try {
                    const topics = JSON.parse(config.staff_topics);
                    if (topics.logs) {
                        targetChatId = config.staff_group_id;
                        messageThreadId = topics.logs;
                    }
                } catch (e) { }
            }

            await _botInstance.api.sendMessage(targetChatId, text, {
                message_thread_id: messageThreadId,
                disable_web_page_preview: true,
                parse_mode: 'HTML'
            });
        } catch (e) {
            logger.error(`[admin-logger] Failed to send local log: ${e.message}`);
        }
    }

    // Send Global Log (Parliament)
    if (isGlobal) {
        try {
            const globalConfig = db.getDb().prepare('SELECT * FROM global_config WHERE id = 1').get();
            if (globalConfig && globalConfig.global_log_channel) {
                await _botInstance.api.sendMessage(globalConfig.global_log_channel, text + "\n#GLOBAL", {
                    disable_web_page_preview: true,
                    parse_mode: 'HTML'
                });
            }
        } catch (e) {
            logger.error(`[admin-logger] Failed to send global log: ${e.message}`);
        }
    }
}

module.exports = {
    init,
    logEvent
};
