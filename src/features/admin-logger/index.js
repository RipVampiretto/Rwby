// ============================================================================
// ADMIN LOGGER MODULE
// ============================================================================
// SCOPO: Sistema centralizzato di logging per azioni del BOT.
// Registra SOLO azioni automatiche del bot (ban, delete, ecc).
// Template unico per tutti gli eventi. Matrice granulare modulo x azione.
// ============================================================================

// log_events format: { "lang_delete": true, "nsfw_ban": true, ... }

let db = null;
let logEvent = null;
let _botInstance = null;
const { safeEdit, isFromSettingsMenu } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Create logEvent function
    logEvent = async function (params) {
        if (!db || !_botInstance) return;

        const { guildId, guildName, eventType, targetUser, executorModule, reason, messageLink, isGlobal } = params;

        // Get Config
        const config = db.getGuildConfig(guildId);
        if (!config) return;

        // Parse log_events as object (new format) or migrate from array (old format)
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

        // Module name map
        const moduleMap = {
            'lang_delete': 'Language Monitor',
            'lang_ban': 'Language Monitor',
            'nsfw_delete': 'NSFW Monitor',
            'nsfw_ban': 'NSFW Monitor',
            'link_delete': 'Link Monitor',
            'ai_delete': 'AI Moderation',
            'ai_ban': 'AI Moderation',
            'keyword_delete': 'Keyword Monitor',
            'keyword_ban': 'Keyword Monitor',
            'staff_ban': 'Staff Coordination',
            'staff_delete': 'Staff Coordination',
            'staff_dismiss': 'Staff Coordination'
        };
        const moduleName = executorModule || moduleMap[eventType] || 'System';

        // Emoji map
        const emojiMap = {
            'lang_delete': '🌐', 'lang_ban': '🌐',
            'nsfw_delete': '🔞', 'nsfw_ban': '🔞',
            'link_delete': '🔗',
            'ai_delete': '🤖', 'ai_ban': '🤖',
            'keyword_delete': '🔤', 'keyword_ban': '🔤',
            'staff_ban': '👮', 'staff_delete': '👮', 'staff_dismiss': '👮'
        };
        const emoji = emojiMap[eventType] || 'ℹ️';

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

        let text = `${emoji} #${moduleTag} #${actionType}\n`;
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
    };

    // Command: /logconfig
    bot.command("logconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        if (!await isAdmin(ctx, 'admin-logger')) return ctx.reply("⚠️ Admin only.");

        await sendConfigUI(ctx);
    });

    // Action Handlers for Config
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("log_")) return next();

        const config = db.getGuildConfig(ctx.chat.id);
        let logEvents = {};
        if (config.log_events) {
            try { logEvents = JSON.parse(config.log_events); } catch (e) { }
            if (Array.isArray(logEvents)) logEvents = {}; // Reset if old format
        }
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === "log_close") {
            await ctx.deleteMessage();
        }
        else if (data === "log_set_channel") {
            await ctx.answerCallbackQuery("Usa /setlogchannel <ID> nel gruppo");
        }
        else if (data.startsWith("log_t:")) {
            // Toggle format: log_t:module_action (e.g., log_t:lang_delete)
            const key = data.split(":")[1];
            logEvents[key] = !logEvents[key];
            db.updateGuildConfig(ctx.chat.id, { log_events: JSON.stringify(logEvents) });
            await sendConfigUI(ctx, true, fromSettings);
        }
    });

    bot.command("setlogchannel", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        if (!await isAdmin(ctx, 'admin-logger')) return;

        const args = ctx.message.text.split(' ').slice(1);

        if (!args[0]) {
            return ctx.reply("❌ Specifica l'ID del canale.\nUso: `/setlogchannel -100123456789`", { parse_mode: 'Markdown' });
        }

        const targetId = parseInt(args[0]);
        if (isNaN(targetId)) {
            return ctx.reply("❌ ID non valido. Usa: /setlogchannel -100123456789");
        }

        // Test permission by sending a message
        try {
            const testMsg = await _botInstance.api.sendMessage(targetId, "✅ Test connessione log channel riuscito.");
            await _botInstance.api.deleteMessage(targetId, testMsg.message_id);

            db.updateGuildConfig(ctx.chat.id, { log_channel_id: targetId });
            await ctx.reply(`✅ Canale log impostato: \`${targetId}\``, { parse_mode: 'Markdown' });
        } catch (e) {
            await ctx.reply(`❌ Impossibile inviare messaggi nel canale \`${targetId}\`.\nAssicurati che il bot sia admin con permessi di scrittura.`, { parse_mode: 'Markdown' });
        }
    });
}

async function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);

    let logEvents = {};
    if (config.log_events) {
        try { logEvents = JSON.parse(config.log_events); } catch (e) { }
        if (Array.isArray(logEvents)) logEvents = {};
    }

    const has = (key) => logEvents[key] ? '✅' : '❌';

    const channelInfo = config.log_channel_id ? `✅ Attivo` : "❌ Non impostato";
    const text = `📋 <b>CONFIGURAZIONE LOG</b>\n\n` +
        `Registra le azioni automatiche del bot.\n\n` +
        `Canale: ${channelInfo}\n\n` +
        `Attiva i log per modulo/azione:`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "log_close" };

    // Matrix layout: each row = module with delete/ban toggles
    const keyboard = {
        inline_keyboard: [
            [{ text: "📢 Imposta Canale", callback_data: "log_set_channel" }],
            // Header row
            [{ text: "Modulo", callback_data: "log_noop" }, { text: "🗑️", callback_data: "log_noop" }, { text: "🚷", callback_data: "log_noop" }],
            // Lang
            [{ text: "🌐 Lang", callback_data: "log_noop" }, { text: has('lang_delete'), callback_data: "log_t:lang_delete" }, { text: has('lang_ban'), callback_data: "log_t:lang_ban" }],
            // NSFW
            [{ text: "🔞 NSFW", callback_data: "log_noop" }, { text: has('nsfw_delete'), callback_data: "log_t:nsfw_delete" }, { text: has('nsfw_ban'), callback_data: "log_t:nsfw_ban" }],
            // Link
            [{ text: "🔗 Link", callback_data: "log_noop" }, { text: has('link_delete'), callback_data: "log_t:link_delete" }, { text: "—", callback_data: "log_noop" }],
            // AI
            [{ text: "🤖 AI", callback_data: "log_noop" }, { text: has('ai_delete'), callback_data: "log_t:ai_delete" }, { text: has('ai_ban'), callback_data: "log_t:ai_ban" }],
            // Keyword
            [{ text: "🔤 Keys", callback_data: "log_noop" }, { text: has('keyword_delete'), callback_data: "log_t:keyword_delete" }, { text: has('keyword_ban'), callback_data: "log_t:keyword_ban" }],
            // Staff header
            // [{ text: "— Staff —", callback_data: "log_noop" }, { text: "—", callback_data: "log_noop" }, { text: "—", callback_data: "log_noop" }],
            // Staff
            [{ text: "👮 Staff", callback_data: "log_noop" }, { text: has('staff_delete'), callback_data: "log_t:staff_delete" }, { text: has('staff_ban'), callback_data: "log_t:staff_ban" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        try {
            await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
        } catch (e) {
            logger.error(`[admin-logger] sendConfigUI error: ${e.message}`);
        }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    }
}

async function isAdmin(ctx, source) {
    try {
        const member = await ctx.getChatMember(ctx.from.id);
        return ['creator', 'administrator'].includes(member.status);
    } catch (e) {
        return false;
    }
}

module.exports = { register, getLogEvent: () => logEvent, sendConfigUI };
