// ============================================================================
// ADMIN LOGGER MODULE
// ============================================================================
// SCOPO: Sistema centralizzato di logging per azioni del BOT.
// Registra SOLO azioni automatiche del bot (ban, delete, ecc).
// Template unico per tutti gli eventi.
// ============================================================================

// ----------------------------------------------------------------------------
// EVENTI SUPPORTATI:
// - ban: Ban eseguito dal bot
// - delete: Messaggio eliminato dal bot  
// - ai_action: Azione AI moderation
// - lang_violation: Violazione lingua
// - link_block: Link bloccato
// - nsfw: Contenuto NSFW
// - keyword: Keyword detection
// ----------------------------------------------------------------------------

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

        const { guildId, eventType, targetUser, executorModule, reason, messageLink, isGlobal } = params;

        // Get Config
        const config = db.getGuildConfig(guildId);
        if (!config) return;

        const logEvents = config.log_events ? JSON.parse(config.log_events) : ['ban', 'delete'];

        // Check if event is enabled
        if (!logEvents.includes(eventType)) return;

        // Format Message - Unified Template
        const emoji = getEventEmoji(eventType);
        const tag = eventType.toUpperCase().replace('_', '');

        let text = `${emoji} #${tag}\n`;
        text += `• Modulo: ${executorModule || 'System'}\n`;
        text += `• Utente: ${targetUser?.first_name || 'Unknown'}`;
        if (targetUser?.username) text += ` (@${targetUser.username})`;
        text += ` [${targetUser?.id}]\n`;
        text += `• Gruppo: ${config.guild_name || 'Unknown'} [${guildId}]\n`;
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

                // Check for staff topics
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
                    disable_web_page_preview: true
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
                        disable_web_page_preview: true
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
        let logEvents = config.log_events ? JSON.parse(config.log_events) : [];
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === "log_close") {
            await ctx.deleteMessage();
        }
        else if (data === "log_set_channel") {
            await ctx.answerCallbackQuery("Usa /setlogchannel nel canale desiderato");
        }
        else if (data.startsWith("log_toggle:")) {
            const event = data.split(":")[1];
            if (logEvents.includes(event)) {
                logEvents = logEvents.filter(e => e !== event);
            } else {
                logEvents.push(event);
            }
            db.updateGuildConfig(ctx.chat.id, { log_events: JSON.stringify(logEvents) });
            await sendConfigUI(ctx, true, fromSettings);
        }
    });

    bot.command("setlogchannel", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        if (!await isAdmin(ctx, 'admin-logger')) return;

        const args = ctx.message.text.split(' ').slice(1);

        if (!args[0]) {
            return ctx.reply("❌ Specifica l'ID del canale.\\nUso: `/setlogchannel -100123456789`", { parse_mode: 'Markdown' });
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
    const logEvents = config.log_events ? JSON.parse(config.log_events) : [];
    function has(ev) { return logEvents.includes(ev) ? '✅' : '❌'; }

    const channelInfo = config.log_channel_id ? `✅ Attivo` : "❌ Non impostato";
    const text = `📋 <b>CONFIGURAZIONE LOG</b>\n\n` +
        `Registra le azioni automatiche del bot.\n\n` +
        `Canale: ${channelInfo}\n` +
        `Eventi attivi: ${logEvents.length}`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "log_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: "📢 Imposta Canale", callback_data: "log_set_channel" }],
            [
                { text: `${has('ban')} Ban`, callback_data: `log_toggle:ban` },
                { text: `${has('delete')} Delete`, callback_data: `log_toggle:delete` }
            ],
            [
                { text: `${has('ai_action')} AI`, callback_data: `log_toggle:ai_action` },
                { text: `${has('nsfw')} NSFW`, callback_data: `log_toggle:nsfw` }
            ],
            [
                { text: `${has('lang_violation')} Lingua`, callback_data: `log_toggle:lang_violation` },
                { text: `${has('link_block')} Link`, callback_data: `log_toggle:link_block` }
            ],
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

function getEventEmoji(type) {
    const map = {
        ban: '🚷',
        delete: '🗑️',
        ai_action: '🤖',
        nsfw: '🔞',
        lang_violation: '🌐',
        link_block: '🔗',
        keyword: '🔤'
    };
    return map[type] || 'ℹ️';
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
