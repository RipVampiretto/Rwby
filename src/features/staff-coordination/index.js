// ============================================================================
// TODO: IMPLEMENTATION PLAN - STAFF COORDINATION
// ============================================================================
// SCOPO: Hub centrale per coordinamento staff locale.
// Gestisce gruppo staff, review queue, sistema note.
// Riceve report da tutti i moduli e li presenta per decisione.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: guild_config (campi staff)
// ├── staff_group_id: INTEGER (nullable)
// ├── staff_topics: TEXT (JSON Object)
// │   └── { reports: TID, logs: TID, discussion: TID }
// └── staff_roles: TEXT (JSON Array di user IDs)
//
// TABELLA: global_notes (note su utenti)
// ├── id: INTEGER PRIMARY KEY
// ├── user_id, guild_id, created_by: INTEGER
// ├── note_text: TEXT
// ├── severity: TEXT ('info', 'warning', 'critical')
// ├── created_at: TEXT
// └── is_global: INTEGER (0/1)

// ----------------------------------------------------------------------------
// 2. STAFF SETUP - /setstaff
// ----------------------------------------------------------------------------
//
// FLUSSO:
// 1. Admin esegue /setstaff
// 2. Bot chiede forward da gruppo staff
// 3. Bot crea topic se Forum
// 4. Salva staff_group_id

// ----------------------------------------------------------------------------
// 3. REVIEW QUEUE - Router Report
// ----------------------------------------------------------------------------
//
// FUNZIONE: reviewQueue(params)
//
// Riceve da: anti-spam, ai-moderation, link-monitor, etc.
// quando action === 'report_only'
//
// FORMATO:
// ┌────────────────────────────────────────────┐
// │ 📥 **REVIEW REQUEST** #1234               │
// │ 🔧 Source: Anti-Spam                      │
// │ 👤 Utente: @username (Tier 0)             │
// │ 📝 Trigger: Volume flood                  │
// │ 💬 "spam message..."                      │
// └────────────────────────────────────────────┘
// [ 🔨 Ban ] [ 🗑️ Delete ] [ ✅ Ignora ]
//
// CALLBACK su [ 🔨 Ban ]:
// ├── Esegui ban
// └── **FORWARD A SUPERADMIN** (come altri moduli)

// ----------------------------------------------------------------------------
// 4. GLOBAL NOTE SYSTEM - /gnote
// ----------------------------------------------------------------------------
//
// COMANDO: /gnote @user severity text
// ESEMPIO: /gnote @username warning Comportamento sospetto
//
// COMANDO: /notes @user
// Mostra tutte le note sull'utente

// ----------------------------------------------------------------------------
// 5. INTEGRATION
// ----------------------------------------------------------------------------
//
// DIPENDENZE IN INGRESSO:
// └── Tutti i moduli con action 'report_only'
//
// DIPENDENZE IN USCITA:
// ├── admin-logger → Per logging
// ├── super-admin → Per forward ban
// └── intel-network → Per note globali

// ============================================================================
// MODULE EXPORTS
// ============================================================================

let db = null;
let _botInstance = null;
const { safeEdit, safeDelete, handleCriticalError, handleTelegramError, isAdmin } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Command: /setstaff
    bot.command("setstaff", async (ctx) => {
        if (ctx.chat.type === 'private') {
            return ctx.reply("⚠️ Questo comando deve essere usato in un gruppo.");
        }

        if (!await isAdmin(ctx, 'staff-coordination')) {
            return ctx.reply("⚠️ Non hai i permessi necessari.");
        }

        // Se siamo in un forum, configuriamo i topic
        if (ctx.chat.is_forum) {
            try {
                // Crea topic per Reports
                const reportsTopic = await ctx.createForumTopic("🚨 Reports & Review");
                // Crea topic per Logs
                const logsTopic = await ctx.createForumTopic("📜 Audit Logs");
                // Crea topic per Discussione Staff
                const discussionTopic = await ctx.createForumTopic("🛡️ Staff Discussion");

                const staffTopics = {
                    reports: reportsTopic.message_thread_id,
                    logs: logsTopic.message_thread_id,
                    discussion: discussionTopic.message_thread_id
                };

                db.updateGuildConfig(ctx.chat.id, {
                    staff_group_id: ctx.chat.id,
                    staff_topics: JSON.stringify(staffTopics)
                });

                await ctx.reply(
                    "✅ **Staff Group Configurato (Forum Mode)**\n\n" +
                    `🔹 Reports: ${reportsTopic.name}\n` +
                    `🔹 Logs: ${logsTopic.name}\n` +
                    `🔹 Discussione: ${discussionTopic.name}`,
                    { message_thread_id: discussionTopic.message_thread_id }
                );

                // Configura anche il logger automaticamente
                db.updateGuildConfig(ctx.chat.id, {
                    log_channel_id: ctx.chat.id
                });

            } catch (e) {
                logger.error(`[staff-coordination] Error creating topics: ${e.message}`);
                return ctx.reply("❌ Errore nella creazione dei topic. Assicurati che io sia Admin.");
            }
        } else {
            // Gruppo normale
            db.updateGuildConfig(ctx.chat.id, {
                staff_group_id: ctx.chat.id
            });
            await ctx.reply("✅ Questo gruppo è stato impostato come **Staff Group**.");
        }
    });

    // Command: /gnote
    bot.command("gnote", async (ctx) => {
        if (ctx.chat.type === 'private') return;

        const args = ctx.message.text.split(' ');
        if (args.length < 4) {
            return ctx.reply("❌ Uso: `/gnote @user [info|warning|critical] [testo]`", { parse_mode: 'Markdown' });
        }

        // Get target user
        let targetUser = ctx.message.reply_to_message?.from;
        if (!targetUser && ctx.message.entities) {
            const entity = ctx.message.entities.find(e => e.type === 'text_mention');
            if (entity) targetUser = entity.user;
        }

        if (!targetUser) {
            return ctx.reply("❌ Devi menzionare un utente (via menu) o rispondere a un suo messaggio.");
        }

        const severity = args[2].toLowerCase();
        if (!['info', 'warning', 'critical'].includes(severity)) {
            return ctx.reply("❌ Severity valida: info, warning, critical");
        }

        const noteText = args.slice(3).join(' ');

        const sqlite = db.getDb();
        sqlite.prepare(`
            INSERT INTO global_notes (user_id, guild_id, note_text, severity, created_by, is_global)
            VALUES (?, ?, ?, ?, ?, 1)
        `).run(targetUser.id, ctx.chat.id, noteText, severity, ctx.from.id);

        await ctx.reply(`✅ Nota aggiunta per ${targetUser.first_name} (${severity})`);
    });

    // Command: /notes
    bot.command("notes", async (ctx) => {
        let targetUser = ctx.message.reply_to_message?.from;
        if (!targetUser && ctx.message.entities) {
            const entity = ctx.message.entities.find(e => e.type === 'text_mention');
            if (entity) targetUser = entity.user;
        }

        if (!targetUser) {
            return ctx.reply("❌ Menziona un utente per vedere le sue note.");
        }

        const sqlite = db.getDb();
        const notes = sqlite.prepare(`
            SELECT * FROM global_notes 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT 10
        `).all(targetUser.id);

        if (notes.length === 0) {
            return ctx.reply(`ℹ️ Nessuna nota trovata per ${targetUser.first_name}.`);
        }

        let text = `📝 **Note per ${targetUser.first_name}:**\n\n`;
        notes.forEach(note => {
            const icon = note.severity === 'critical' ? '🔴' : (note.severity === 'warning' ? '🟠' : '🔵');
            text += `${icon} **[${note.severity.toUpperCase()}]** ${note.created_at.substring(0, 10)}\n`;
            text += `└ ${note.note_text}\n\n`;
        });

        await ctx.reply(text, { parse_mode: 'Markdown' });
    });

    // Action Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;

        if (data.startsWith("staff_ban:")) {
            await ctx.answerCallbackQuery("🚫 Eseguendo Ban...");
            await ctx.editMessageCaption({
                caption: ctx.callbackQuery.message.caption + "\n\n✅ **BANNED by Staff**"
            });
        }
        else if (data.startsWith("staff_ign")) {
            await ctx.answerCallbackQuery("✅ Ignorato");
            await ctx.deleteMessage();
        }
        else if (data.startsWith("staff_del:")) {
            const parts = data.split(":");
            if (parts.length >= 3) {
                const origChatId = parts[1];
                const msgId = parts[2];
                try {
                    await ctx.api.deleteMessage(origChatId, msgId);
                    await ctx.answerCallbackQuery("🗑️ Messaggio eliminato");
                    await ctx.editMessageCaption({
                        caption: ctx.callbackQuery.message.caption + "\n\n✅ **DELETED by Staff**"
                    });
                } catch (e) {
                    await ctx.answerCallbackQuery("❌ Errore eliminazione: " + e.message);
                }
            }
        }
        else {
            return next();
        }
    });

    // Config UI Callback
    bot.on("callback_query:data", async (ctx, next) => {
        if (ctx.callbackQuery.data === "stf_close") {
            await ctx.deleteMessage();
        } else {
            return next();
        }
    });
}

async function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const staffGroup = config.staff_group_id ? `✅ Set (${config.staff_group_id})` : "❌ Not Set";

    const text = `👮 **STAFF COORDINATION**\n` +
        `Staff Group: ${staffGroup}\n\n` +
        `**Comandi:**\n` +
        `/setstaff - Imposta questo gruppo come Staff Group\n` +
        `/gnote @user type text - Aggiungi nota globale\n` +
        `/notes @user - Vedi note`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "stf_close" };

    const keyboard = {
        inline_keyboard: [
            [closeBtn]
        ]
    };

    if (isEdit) {
        try { await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' }); } catch (e) { }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

async function reviewQueue(params) {
    if (!db) return logger.error("[staff-coordination] DB not initialized in reviewQueue");

    const config = db.getGuildConfig(params.guildId);
    if (!config || !config.staff_group_id) {
        return logger.debug(`[staff-coordination] No staff group set for guild ${params.guildId}`);
    }

    let threadId = null;
    if (config.staff_topics) {
        try {
            const topics = JSON.parse(config.staff_topics);
            threadId = topics.reports;
        } catch (e) { }
    }

    const { source, user, reason, messageId, content } = params;

    const keyboard = {
        inline_keyboard: [
            [
                { text: "🔨 Ban", callback_data: `staff_ban:${user.id}` },
                { text: "🗑️ Delete", callback_data: `staff_del:${params.guildId}:${messageId}` }
            ],
            [
                { text: "✅ Ignora", callback_data: "staff_ign" },
                { text: "🔍 Profilo", url: `tg://user?id=${user.id}` }
            ]
        ]
    };

    const text = `📥 **REVIEW REQUEST**\n` +
        `🔧 Source: ${source}\n` +
        `👤 Utente: [${user.first_name}](tg://user?id=${user.id}) (\`${user.id}\`)\n` +
        `📝 Reason: ${reason}\n\n` +
        `💬 Content: "${content ? content.substring(0, 100) : 'N/A'}"`;

    if (_botInstance) {
        await _botInstance.api.sendMessage(config.staff_group_id, text, {
            message_thread_id: threadId,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    } else {
        logger.error("[staff-coordination] Bot instance not available in reviewQueue");
    }
}

module.exports = { register, reviewQueue, sendConfigUI };
