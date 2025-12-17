// ============================================================================
// TODO: IMPLEMENTATION PLAN - ADMIN LOGGER
// ============================================================================
// SCOPO: Sistema centralizzato di logging per tutte le azioni di moderazione.
// Registra ban, delete, e azioni automatiche. Dual scope: locale e globale.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: guild_config (campi logger)
// ├── log_channel_id: INTEGER (nullable)
// │   └── ID topic o chat dove inviare log locali
// ├── log_events: TEXT (JSON Array)
// │   └── Eventi da loggare: ['ban', 'delete', 'ai_action', 'spam', 'config']
// └── log_format: TEXT ('minimal', 'standard', 'extended')
//     └── minimal: solo essenziale
//     └── standard: info complete
//     └── extended: debug/evidence allegata

// ----------------------------------------------------------------------------
// 2. LOGGING ENGINE - Funzione Centrale
// ----------------------------------------------------------------------------
//
// FUNZIONE: logEvent(params)
//
// PARAMETRI:
// ├── guildId: INTEGER
// ├── eventType: TEXT ('ban', 'delete', 'config_change', ...)
// ├── targetUser: Object ({ id, name, username })
// ├── executorAdmin: Object ({ id, name, username }) - o 'SYSTEM' se auto
// ├── reason: TEXT
// ├── proof: Object (nullable, allegati)
// ├── metadata: Object (dati extra modulo-specifici)
// └── isGlobal: BOOLEAN (se true, invia anche a SuperAdmin log)
//
// FLUSSO:
// 1. Lookup log_channel_id da guild_config
// 2. Check se eventType è in log_events
// 3. Format messaggio secondo log_format
// 4. Invia a log_channel_id locale
// 5. IF isGlobal: invia anche a global_log_channel

// ----------------------------------------------------------------------------
// 3. DUAL SCOPE ROUTING - Locale vs Globale
// ----------------------------------------------------------------------------
//
// EVENTI LOCALI:
// ├── Azioni admin manuali nel gruppo
// ├── Eliminazioni spam automatiche
// └── Cambio configurazione feature
//
// EVENTI GLOBALI (inviati anche a Parliament):
// ├── Tutti i BAN (automatici e manuali)
// ├── Rilevamenti AI critici (SCAM, THREAT)
// └── Cambi configurazione globale

// ----------------------------------------------------------------------------
// 4. CONFIGURATION UI - /logconfig
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ 📋 **CONFIGURAZIONE LOG**                  │
// │ Canale: #moderazione-log                   │
// │ Eventi attivi: 5/6                         │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ 📢 Canale ] → "Forwarda un messaggio dal canale"
// [ 📝 Formato: Standard ▼ ]
// [ ✅ Ban ] [ ✅ Delete ] [ ✅ AI ]
// [ ✅ Spam ] [ ❌ Config ] [ ✅ Flux ]
// [ 💾 Salva ] [ ❌ Chiudi ]

// ----------------------------------------------------------------------------
// 5. INTEGRATION
// ----------------------------------------------------------------------------
//
// DIPENDENZE IN INGRESSO (riceve da):
// ├── anti-spam → Ban/delete events
// ├── ai-moderation → AI detection events
// ├── anti-edit-abuse → Edit abuse events
// ├── link-monitor → Link ban events
// ├── keyword-monitor → Keyword ban events
// ├── language-monitor → Language events
// ├── nsfw-monitor → NSFW events
// ├── visual-immune-system → Visual match events
// ├── vote-ban → Community ban events
// └── super-admin → Global events
//
// FUNZIONE ESPOSTA:
// └── logEvent(params) → void

// ============================================================================
// MODULE EXPORTS
// ============================================================================

let db = null;
let logEvent = null;
let _botInstance = null;

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Create logEvent function
    logEvent = async function (params) {
        if (!db || !_botInstance) return;

        const { guildId, eventType, targetUser, executorAdmin, reason, proof, severity, isGlobal } = params;

        // 1. Get Config
        const config = db.getGuildConfig(guildId);
        if (!config) return;

        const logEvents = config.log_events ? JSON.parse(config.log_events) : ['ban', 'delete', 'ai_action'];

        // 2. Check filters
        if (!logEvents.includes(eventType) && eventType !== 'force') {
            return;
        }

        // 3. Format Message
        const format = config.log_format || 'standard';
        let text = "";

        if (format === 'minimal') {
            text = `#LOG #${eventType.toUpperCase()}\n` +
                `👤 ${targetUser?.username || targetUser?.id}\n` +
                `🔧 ${executorAdmin?.username || executorAdmin?.name || 'System'}\n` +
                `📝 ${reason}`;
        } else {
            // Standard / Extended
            const emoji = getEventEmoji(eventType);
            text = `${emoji} **LOG: ${eventType.toUpperCase()}**\n\n` +
                `📍 Group: ${config.guild_name || guildId}\n` +
                `👤 Target: [${targetUser?.first_name}](tg://user?id=${targetUser?.id}) (\`${targetUser?.id}\`)\n` +
                `🛠 Exec: ${executorAdmin?.username || 'System'}\n` +
                `📝 Reason: ${reason}\n`;

            if (proof && format === 'extended') {
                text += `\nPROOF: ${proof}`; // Simplified proof handling
            }
        }

        // 4. Send Local Log
        if (config.log_channel_id) {
            try {
                // If log channel is same as chat (e.g. forum topic? no, config typically separates)
                // If it's a forum topic, we need thread_id. 
                // Assumption: log_channel_id is the CHAT ID. If it is a topic, it should be handled.
                // Current schema: log_channel_id is simple integer.
                // If we use topics, we likely stored topic ID in 'staff_topics'.
                // Let's use logic: if staff_topics has 'logs', use that thread in staff_group_id.

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
                    parse_mode: 'Markdown',
                    message_thread_id: messageThreadId
                });
            } catch (e) {
                console.error("Failed to send local log:", e.message);
            }
        }

        // 5. Send Global Log
        if (isGlobal) {
            try {
                const globalConfig = db.getDb().prepare('SELECT * FROM global_config WHERE id = 1').get();
                if (globalConfig && globalConfig.global_log_channel) {
                    await _botInstance.api.sendMessage(globalConfig.global_log_channel, text + "\n#GLOBAL", {
                        parse_mode: 'Markdown'
                    });
                }
            } catch (e) {
                console.error("Failed to send global log:", e.message);
            }
        }
    };

    // Command: /logconfig
    bot.command("logconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;

        const member = await ctx.getChatMember(ctx.from.id);
        const isAdmin = ['creator', 'administrator'].includes(member.status);
        if (!isAdmin) return ctx.reply("⚠️ Admin only.");

        const config = db.getGuildConfig(ctx.chat.id);
        const logEvents = config.log_events ? JSON.parse(config.log_events) : [];

        function has(ev) { return logEvents.includes(ev) ? '✅' : '❌'; }

        const keyboard = {
            inline_keyboard: [
                [
                    { text: "📢 Imposta Canale", callback_data: "log_set_channel" }
                ],
                [
                    { text: `Formato: ${config.log_format || 'standard'}`, callback_data: "log_toggle_format" }
                ],
                [
                    { text: `${has('ban')} Ban`, callback_data: `log_toggle:ban` },
                    { text: `${has('delete')} Delete`, callback_data: `log_toggle:delete` },
                    { text: `${has('ai_action')} AI`, callback_data: `log_toggle:ai_action` }
                ],
                [
                    { text: `${has('spam')} Spam`, callback_data: `log_toggle:spam` },
                    { text: `${has('config')} Config`, callback_data: `log_toggle:config` },
                    { text: `${has('flux')} Flux`, callback_data: `log_toggle:flux` }
                ],
                [
                    { text: "❌ Chiudi", callback_data: "log_close" }
                ]
            ]
        };

        const channelInfo = config.log_channel_id ? `Active (${config.log_channel_id})` : "Not set";

        await ctx.reply(
            `📋 **CONFIGURAZIONE LOG**\n` +
            `Canale: ${channelInfo}\n` +
            `Eventi attivi: ${logEvents.length}/6`,
            {
                reply_markup: keyboard,
                parse_mode: 'Markdown'
            }
        );
    });

    // Action Handlers for Config
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("log_")) return next();

        const config = db.getGuildConfig(ctx.chat.id);
        let logEvents = config.log_events ? JSON.parse(config.log_events) : [];

        if (data === "log_close") {
            await ctx.deleteMessage();
        }
        else if (data === "log_set_channel") {
            await ctx.answerCallbackQuery("Invia 'setlog' in un altro canale o topic per impostarlo.");
            // To simplify, we can just say: Run /log_set_here in target channel?
            // Or handle next message... implementation complexity.
            // Simplified: "Reply with channel ID" or use /setlogchannel command separately or here.
            // Let's implement a quick waiter? No, stateless.
            // Just instruct user.
            await ctx.reply("ℹ️ Per impostare il canale di log, crea un topic 'Audit Log' e assegnalo con /setstaff (consigliato) oppure usa /setlogchannel nel canale desiderato.");
        }
        else if (data === "log_toggle_format") {
            const current = config.log_format || 'standard';
            const nextFmt = current === 'minimal' ? 'standard' : (current === 'standard' ? 'extended' : 'minimal');
            db.updateGuildConfig(ctx.chat.id, { log_format: nextFmt });
            await refreshConfigUI(ctx, db);
        }
        else if (data.startsWith("log_toggle:")) {
            const event = data.split(":")[1];
            if (logEvents.includes(event)) {
                logEvents = logEvents.filter(e => e !== event);
            } else {
                logEvents.push(event);
            }
            db.updateGuildConfig(ctx.chat.id, { log_events: JSON.stringify(logEvents) });
            await refreshConfigUI(ctx, db);
        }
    });

    bot.command("setlogchannel", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        const member = await ctx.getChatMember(ctx.from.id);
        if (!['creator', 'administrator'].includes(member.status)) return;

        db.updateGuildConfig(ctx.chat.id, { log_channel_id: ctx.chat.id }); // If in forum, maybe we want current thread? 
        // If forum, 'log_channel_id' usually refers to the main chat ID, and 'staff_topics' handles routing.
        // But if user wants a SPECIFIC channel (non forum setup), this works.
        await ctx.reply(`✅ Canale log impostato: ${ctx.chat.title}`);
    });
}

async function refreshConfigUI(ctx, db) {
    const config = db.getGuildConfig(ctx.chat.id);
    const logEvents = config.log_events ? JSON.parse(config.log_events) : [];
    function has(ev) { return logEvents.includes(ev) ? '✅' : '❌'; }

    const keyboard = {
        inline_keyboard: [
            [{ text: "📢 Imposta Canale", callback_data: "log_set_channel" }],
            [{ text: `Formato: ${config.log_format || 'standard'}`, callback_data: "log_toggle_format" }],
            [
                { text: `${has('ban')} Ban`, callback_data: `log_toggle:ban` },
                { text: `${has('delete')} Delete`, callback_data: `log_toggle:delete` },
                { text: `${has('ai_action')} AI`, callback_data: `log_toggle:ai_action` }
            ],
            [
                { text: `${has('spam')} Spam`, callback_data: `log_toggle:spam` },
                { text: `${has('config')} Config`, callback_data: `log_toggle:config` },
                { text: `${has('flux')} Flux`, callback_data: `log_toggle:flux` }
            ],
            [{ text: "❌ Chiudi", callback_data: "log_close" }]
        ]
    };

    // Try to edit
    try {
        await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
    } catch (e) { }
}

function getEventEmoji(type) {
    const map = {
        ban: '🔨', delete: '🗑️', ai_action: '🤖', spam: '🧹', config: '⚙️', flux: '📉'
    };
    return map[type] || 'ℹ️';
}

module.exports = { register, getLogEvent: () => logEvent };
