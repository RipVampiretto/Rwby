const logger = require('../../middlewares/logger');
const { MODULE_MAP, EMOJI_MAP } = require('./utils');
const i18n = require('../../i18n');

let db = null;
let _botInstance = null;

function init(bot, database) {
    _botInstance = bot;
    db = database;
}

async function logEvent(params) {
    if (!db || !_botInstance) return;

    const { guildId, guildName, eventType, targetUser, executorModule, reason, messageLink } = params;

    const config = await db.getGuildConfig(guildId);
    if (!config) return;

    // Get the guild's UI language
    const lang = await i18n.getLanguage(guildId);
    const t = (key, p) => i18n.t(lang, key, p);

    let logEvents = {};
    if (config.log_events) {
        try {
            const parsed = typeof config.log_events === 'string' ? JSON.parse(config.log_events) : config.log_events;
            if (Array.isArray(parsed)) {
                parsed.forEach(t => {
                    logEvents[`${t}_delete`] = true;
                    logEvents[`${t}_ban`] = true;
                });
            } else {
                logEvents = parsed;
            }
        } catch (e) { }
    }

    if (!logEvents[eventType]) return;

    const moduleName = executorModule || MODULE_MAP[eventType] || 'System';
    const emoji = EMOJI_MAP[eventType] || 'ℹ️';

    let actionType = 'ACTION';
    if (eventType.endsWith('_ban')) actionType = 'BAN';
    else if (eventType.endsWith('_delete')) actionType = 'DELETE';
    else if (eventType.endsWith('_dismiss')) actionType = 'DISMISS';
    const moduleTag = eventType.split('_')[0].toUpperCase();

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

    const tags = params.customTags || [`#${moduleTag}`, `#${actionType}`];
    let text = `${emoji} ${tags.join(' ')}\n`;
    text += `• ${t('logger.log.by')}: ${botLink} [${botInfo.id}]\n`;
    text += `• ${t('logger.log.to')}: ${userLink} [${targetUser?.id}]\n`;
    text += `• ${t('logger.log.group')}: ${guildName || config.guild_name || guildId} [${guildId}]\n`;
    text += `• ${t('logger.log.reason')}: ${reason}\n`;
    if (messageLink) {
        text += `• 👀 ${t('logger.log.go_to_message')} (${messageLink})\n`;
    }
    text += `#id${targetUser?.id}`;

    if (config.log_channel_id) {
        try {
            let targetChatId = config.log_channel_id;
            let messageThreadId = null;

            if (config.staff_group_id && config.staff_topics) {
                try {
                    const topics =
                        typeof config.staff_topics === 'string' ? JSON.parse(config.staff_topics) : config.staff_topics;
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
            logger.error(`[action-log] Failed to send local log: ${e.message}`);
        }
    }

}

module.exports = {
    init,
    logEvent
};
