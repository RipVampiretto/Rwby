// ============================================================================
// STAFF COORDINATION MODULE
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
const adminLogger = require('../admin-logger');

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Command: /setstaff <id>
    bot.command("setstaff", async (ctx) => {
        if (ctx.chat.type === 'private') {
            return ctx.reply("⚠️ Questo comando deve essere usato in un gruppo.");
        }

        if (!await isAdmin(ctx, 'staff-coordination')) {
            return ctx.reply("⚠️ Non hai i permessi necessari.");
        }

        const args = ctx.message.text.split(' ').slice(1);

        if (!args[0]) {
            return ctx.reply("❌ Specifica l'ID del gruppo staff.\nUso: `/setstaff -100123456789`", { parse_mode: 'Markdown' });
        }

        const staffId = parseInt(args[0]);
        if (isNaN(staffId)) {
            return ctx.reply("❌ ID non valido. Usa: /setstaff -100123456789");
        }

        // Test permission by sending a message
        try {
            const testMsg = await _botInstance.api.sendMessage(staffId, "✅ Test connessione Staff Group riuscito.");
            await _botInstance.api.deleteMessage(staffId, testMsg.message_id);

            db.updateGuildConfig(ctx.chat.id, { staff_group_id: staffId });
            await ctx.reply(`✅ Staff Group impostato: \`${staffId}\``, { parse_mode: 'Markdown' });
        } catch (e) {
            await ctx.reply(`❌ Impossibile inviare messaggi nel gruppo \`${staffId}\`.\nAssicurati che il bot sia admin con permessi di scrittura.`, { parse_mode: 'Markdown' });
        }
    });

    // Command: /notes - View or add notes (staff-group scoped)
    // Usage: /notes <user_id> - View notes
    //        /notes add <user_id> <text> - Add note
    bot.command("notes", async (ctx) => {
        if (ctx.chat.type === 'private') return;

        const config = db.getGuildConfig(ctx.chat.id);
        const staffGroupId = config.staff_group_id || ctx.chat.id;

        const args = ctx.message.text.split(' ').slice(1);

        // /notes add <id> <text>
        if (args[0] === 'add') {
            if (args.length < 3) {
                return ctx.reply("❌ Uso: `/notes add <user_id> <testo>`", { parse_mode: 'Markdown' });
            }

            const targetId = parseInt(args[1]);
            if (isNaN(targetId)) {
                return ctx.reply("❌ ID utente non valido.");
            }

            const noteText = args.slice(2).join(' ');

            const sqlite = db.getDb();
            sqlite.prepare(`
                INSERT INTO staff_notes (user_id, staff_group_id, note_text, created_by)
                VALUES (?, ?, ?, ?)
            `).run(targetId, staffGroupId, noteText, ctx.from.id);

            await ctx.reply(`✅ Nota aggiunta per utente \`${targetId}\``, { parse_mode: 'Markdown' });
            return;
        }

        // /notes <id> - View notes
        let targetId = parseInt(args[0]);

        // Also support reply-to-message
        if (!targetId && ctx.message.reply_to_message?.from) {
            targetId = ctx.message.reply_to_message.from.id;
        }

        if (!targetId) {
            return ctx.reply("❌ Uso:\n`/notes <user_id>` - Visualizza note\n`/notes add <user_id> <severity> <testo>` - Aggiungi nota", { parse_mode: 'Markdown' });
        }

        const sqlite = db.getDb();
        const notes = sqlite.prepare(`
            SELECT * FROM staff_notes 
            WHERE user_id = ? AND staff_group_id = ?
            ORDER BY created_at DESC 
            LIMIT 10
        `).all(targetId, staffGroupId);

        if (notes.length === 0) {
            return ctx.reply(`ℹ️ Nessuna nota trovata per utente \`${targetId}\`.`, { parse_mode: 'Markdown' });
        }

        let text = `📝 <b>Note per utente ${targetId}:</b>\n\n`;
        notes.forEach(note => {
            const icon = note.severity === 'critical' ? '🔴' : (note.severity === 'warning' ? '🟠' : '🔵');
            text += `${icon} <b>[${note.severity.toUpperCase()}]</b> ${note.created_at.substring(0, 10)}\n`;
            text += `└ ${note.note_text}\n\n`;
        });

        await ctx.reply(text, { parse_mode: 'HTML' });
    });

    // Action Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;

        if (data.startsWith("staff_ban:")) {
            // Format: staff_ban:userId:guildId
            const parts = data.split(":");
            const targetUserId = parts[1];
            const originalGuildId = parts[2];

            await ctx.answerCallbackQuery("🚫 Eseguendo Ban...");

            // Actually ban the user in the original group
            try {
                await _botInstance.api.banChatMember(originalGuildId, targetUserId);
                await ctx.editMessageCaption({
                    caption: ctx.callbackQuery.message.caption + "\n\n✅ **BANNED by " + ctx.from.first_name + "**"
                });
            } catch (e) {
                logger.error(`[staff-coordination] Ban failed: ${e.message}`);
                await ctx.editMessageCaption({
                    caption: ctx.callbackQuery.message.caption + "\n\n❌ **Ban fallito: " + e.message + "**"
                });
            }

            // Log staff action
            if (adminLogger.getLogEvent()) {
                adminLogger.getLogEvent()({
                    guildId: originalGuildId,
                    eventType: 'staff_ban',
                    targetUser: { id: targetUserId, first_name: 'User' },
                    executorModule: `Staff: ${ctx.from.first_name}`,
                    reason: 'Approved from review queue',
                    isGlobal: true
                });
            }
        }
        else if (data.startsWith("staff_ign")) {
            await ctx.answerCallbackQuery("✅ Ignorato");
            await ctx.deleteMessage();

            // Log staff dismiss
            if (adminLogger.getLogEvent()) {
                adminLogger.getLogEvent()({
                    guildId: ctx.chat.id,
                    eventType: 'staff_dismiss',
                    targetUser: { id: 0, first_name: 'Unknown' },
                    executorModule: `Staff: ${ctx.from.first_name}`,
                    reason: 'Dismissed from review queue',
                    isGlobal: false
                });
            }
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

                    // Log staff delete
                    if (adminLogger.getLogEvent()) {
                        adminLogger.getLogEvent()({
                            guildId: origChatId,
                            eventType: 'staff_delete',
                            targetUser: { id: 0, first_name: 'Unknown' },
                            executorModule: `Staff: ${ctx.from.first_name}`,
                            reason: 'Deleted from review queue',
                            isGlobal: false
                        });
                    }
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
        `/setstaff <id> - Imposta Staff Group\n` +
        `/notes <id> - Vedi note utente\n` +
        `/notes add <id> <testo> - Aggiungi nota`;

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
                { text: "🔨 Ban", callback_data: `staff_ban:${user.id}:${params.guildId}` },
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
