// ============================================================================
// TODO: IMPLEMENTATION PLAN - SUPER ADMIN (Parliament System)
// ============================================================================
// SCOPO: Governance centrale della rete federata.
// RICEVE: Forward di TUTTI i ban dalla rete (auto-delete dopo 24h).
// CONTROLLA: Ban globali, blacklist link/parole, trust gruppi.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: global_config
// ├── super_admin_ids: TEXT (JSON Array, meglio da ENV)
// ├── parliament_group_id: INTEGER
// ├── global_topics: TEXT (JSON)
// │   └── { bans: TID, bills: TID, logs: TID, appeals: TID }
// ├── global_log_channel: INTEGER
// └── network_mode: TEXT ('normal', 'maintenance')
//
// TABELLA: pending_deletions (forward da eliminare)
// ├── message_id: INTEGER
// ├── chat_id: INTEGER
// ├── created_at: TEXT
// └── delete_after: TEXT (created_at + 24h)
//
// TABELLA: bills (proposte globali)
// ├── id: INTEGER PRIMARY KEY
// ├── type: TEXT ('global_ban', 'blacklist_add')
// ├── target: TEXT
// ├── source_guild: INTEGER
// ├── metadata: TEXT (JSON)
// ├── status: TEXT ('pending', 'ratified', 'vetoed')
// └── created_at: TEXT

// ----------------------------------------------------------------------------
// 2. BAN FORWARD RECEIVER - Endpoint Centrale
// ----------------------------------------------------------------------------
//
// OGNI volta che un gruppo esegue un ban (automatico o manuale):
// → Il modulo che ha eseguito il ban chiama forwardToParliament()
//
// FORMATO RICEVUTO:
// ┌────────────────────────────────────────────┐
// │ 🔨 **BAN ESEGUITO**                        │
// │                                            │
// │ 🏛️ Gruppo: Nome Gruppo (@handle)          │
// │ 👤 Utente: @user (ID: 123456)             │
// │ 📊 TrustFlux: -45                         │
// │ ⏰ Ora: 2024-12-17 14:30                  │
// │                                            │
// │ 📝 Motivo: Anti-Spam - Volume flood       │
// │ 💬 Evidence: "messaggio spam..."          │
// └────────────────────────────────────────────┘
// [ ➕ Blacklist Link ] [ ➕ Blacklist Parola ]
// [ 🌍 Global Ban ] [ ✅ Solo Locale ]
//
// AZIONI SUPERADMIN:
//
// [ ➕ Blacklist Link ]:
// ├── Estrae automaticamente link dal messaggio
// ├── Wizard: "Confermi blacklist di scam-site.com?"
// └── Salva in intel_data type='blacklist_domain'
//
// [ ➕ Blacklist Parola ]:
// ├── Wizard: "Quale pattern vuoi bloccare?"
// ├── Input: regex o stringa
// └── Salva in intel_data type='blacklist_word'
//
// [ 🌍 Global Ban ]:
// ├── Propaga ban a tutta la rete
// ├── Emette evento GLOBAL_BAN_ADD
// └── Tutti i gruppi Tier 1+ applicano

// ----------------------------------------------------------------------------
// 3. AUTO-DELETE SYSTEM - Cleanup 24h
// ----------------------------------------------------------------------------
//
// ON BAN FORWARD RECEIVED:
// ├── Invia messaggio a parliament topic 'bans'
// ├── Salva message_id in pending_deletions
// └── delete_after = NOW + 24h
//
// CRONJOB (ogni ora):
// SELECT * FROM pending_deletions WHERE delete_after < NOW()
// FOR EACH:
// ├── ctx.api.deleteMessage(chat_id, message_id)
// └── DELETE FROM pending_deletions

// ----------------------------------------------------------------------------
// 4. SETUP COMMANDS
// ----------------------------------------------------------------------------
//
// /setgstaff (nel gruppo Parliament):
// ├── Verifica SuperAdmin
// ├── Crea topic: "🔨 Ban", "📜 Bills", "📋 Logs"
// └── Salva IDs
//
// /setglog (nel canale log):
// └── Salva global_log_channel

// ----------------------------------------------------------------------------
// 5. GOVERNANCE DASHBOARD - /gpanel
// ----------------------------------------------------------------------------
//
// ┌────────────────────────────────────────────┐
// │ 🌍 **GLOBAL GOVERNANCE PANEL**             │
// │ 🏛️ Gruppi: 47 | 🚫 Ban globali: 1,234     │
// │ 📜 Bills pending: 3                        │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ 📜 Bills Pendenti ] [ 📊 Statistiche Rete ]
// [ 🛠️ Configurazione ] [ ❌ Chiudi ]

// ----------------------------------------------------------------------------
// 6. SECURITY
// ----------------------------------------------------------------------------
//
// VERIFICA PERMESSI:
// ├── Tutti i comandi verificano SUPER_ADMIN_IDS da env
// ├── Logging di tutte le azioni
// └── Rate limit su azioni critiche

// ============================================================================
// MODULE EXPORTS
// ============================================================================

const adminLogger = require('../admin-logger');
const { safeEdit, safeDelete, handleCriticalError, handleTelegramError, safeJsonParse } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');

let db = null;
let _botInstance = null;

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Cron job for pending deletions (every hour)
    setInterval(cleanupPendingDeletions, 3600000);

    // Command: /gpanel (SuperAdmin only)
    bot.command("gpanel", async (ctx) => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply("❌ Accesso negato");

        try {
            const stats = db.getDb().prepare(`
                SELECT 
                    (SELECT COUNT(*) FROM users WHERE is_banned_global = 1) as global_bans,
                    (SELECT COUNT(*) FROM bills WHERE status = 'pending') as pending_bills,
                    (SELECT COUNT(*) FROM guild_trust) as guilds
            `).get();

            const text = `🌍 **GLOBAL GOVERNANCE PANEL**\n` +
                `🏛️ Gruppi: ${stats.guilds}\n` +
                `🚫 Ban globali: ${stats.global_bans}\n` +
                `📜 Bills pending: ${stats.pending_bills}`;

            const keyboard = {
                inline_keyboard: [
                    [{ text: "📜 Bills Pendenti", callback_data: "g_bills" }, { text: "📊 Statistiche Rete", callback_data: "g_stats" }],
                    [{ text: "🛠️ Configurazione", callback_data: "g_config" }, { text: "❌ Chiudi", callback_data: "g_close" }]
                ]
            };

            // If callback, edit. If command, reply.
            if (ctx.callbackQuery) {
                await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
            } else {
                await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
            }
        } catch (e) {
            ctx.reply("❌ Error fetching stats");
        }
    });

    // Command: /setgstaff
    bot.command("setgstaff", async (ctx) => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply("❌ Accesso negato");
        if (ctx.chat.type === 'private') return ctx.reply("❌ Usalo nel gruppo Parliament.");

        try {
            // Create topics if Forum
            let topics = {};
            if (ctx.chat.is_forum) {
                // Core Topics
                const bans = await ctx.createForumTopic("🔨 Bans"); // Ban globali e ratifiche
                const bills = await ctx.createForumTopic("📜 Bills"); // Proposte di governance
                const logs = await ctx.createForumTopic("📋 Logs"); // Log generali

                // New Requested Topics
                const joinLogs = await ctx.createForumTopic("📥 Join Logs"); // Log ingressi utenti
                const addGroup = await ctx.createForumTopic("🆕 Add Group"); // Log nuovi gruppi
                const imageSpam = await ctx.createForumTopic("🖼️ Image Spam"); // Log analisi AI immagini
                const linkChecks = await ctx.createForumTopic("🔗 Link Checks"); // Log link check

                topics = {
                    bans: bans.message_thread_id,
                    bills: bills.message_thread_id,
                    logs: logs.message_thread_id,
                    join_logs: joinLogs.message_thread_id,
                    add_group: addGroup.message_thread_id,
                    image_spam: imageSpam.message_thread_id,
                    link_checks: linkChecks.message_thread_id
                };
            } else {
                return ctx.reply("⚠️ Ottimizzato per Forum (Topic). Creazione topic saltata.");
            }

            // Update Global Config
            db.getDb().prepare(`
                INSERT INTO global_config (id, parliament_group_id, global_topics) 
                VALUES (1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET 
                    parliament_group_id = ?, 
                    global_topics = ?
            `).run(ctx.chat.id, JSON.stringify(topics), ctx.chat.id, JSON.stringify(topics));

            await ctx.reply(
                "✅ **Parliament Group Configurato**\n\n" +
                "Creati i topic per:\n" +
                "- Bans (Ban globali)\n" +
                "- Bills (Proposte)\n" +
                "- Logs (Sistema)\n" +
                "- Join Logs (Ingressi)\n" +
                "- Add Group (Nuovi gruppi)\n" +
                "- Image Spam (Analisi AI)\n" +
                "- Link Checks (Link checks)"
            );
        } catch (e) {
            console.error(e);
            ctx.reply("❌ Errore setup: " + e.message);
        }
    });

    // Command: /setglog
    bot.command("setglog", async (ctx) => {
        if (!isSuperAdmin(ctx.from.id)) return;

        db.getDb().prepare(`
            INSERT INTO global_config (id, global_log_channel) VALUES (1, ?)
            ON CONFLICT(id) DO UPDATE SET global_log_channel = ?
        `).run(ctx.chat.id, ctx.chat.id);

        await ctx.reply("✅ Global Log Channel impostato.");
    });

    // Action Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!isSuperAdmin(ctx.from.id)) {
            // Only superadmins can interact with global ban buttons?
            // Yes generally.


            if (data.startsWith("gban") || data.startsWith("g_")) {
                return ctx.answerCallbackQuery("❌ Accesso negato");
            }
        }

        if (data === "g_close") return ctx.deleteMessage();

        if (data === "g_menu") {
            // Re-render main menu
            try {
                const stats = db.getDb().prepare(`
                    SELECT 
                        (SELECT COUNT(*) FROM users WHERE is_banned_global = 1) as global_bans,
                        (SELECT COUNT(*) FROM bills WHERE status = 'pending') as pending_bills,
                        (SELECT COUNT(*) FROM guild_trust) as guilds
                `).get();

                const text = `🌍 **GLOBAL GOVERNANCE PANEL**\n` +
                    `🏛️ Gruppi: ${stats.guilds}\n` +
                    `🚫 Ban globali: ${stats.global_bans}\n` +
                    `📜 Bills pending: ${stats.pending_bills}`;

                const keyboard = {
                    inline_keyboard: [
                        [{ text: "📜 Bills Pendenti", callback_data: "g_bills" }, { text: "📊 Statistiche Rete", callback_data: "g_stats" }],
                        [{ text: "🛠️ Configurazione", callback_data: "g_config" }, { text: "❌ Chiudi", callback_data: "g_close" }]
                    ]
                };

                await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
            } catch (e) {
                await ctx.answerCallbackQuery("Error reloading menu");
            }
            return;
        }

        if (data.startsWith("gban:")) {
            const userId = data.split(":")[1];
            await ctx.answerCallbackQuery("🌍 Executing Global Ban...");
            await executeGlobalBan(ctx, userId);
        }
        else if (data.startsWith("gban_skip:")) {
            const msgId = data.split(":")[1];
            await ctx.answerCallbackQuery("✅ Skipped");
            await ctx.deleteMessage();
            // Should verify this deletes the report message.
        }
        else if (data === "g_stats") {
            try {
                const stats = db.getDb().prepare(`
                    SELECT 
                        (SELECT COUNT(*) FROM users WHERE is_banned_global = 1) as global_bans,
                        (SELECT COUNT(*) FROM bills WHERE status = 'pending') as pending_bills,
                        (SELECT COUNT(*) FROM guild_trust) as guilds,
                        (SELECT AVG(trust_score) FROM guild_trust) as avg_trust
                `).get();

                const text = `📊 **NETWORK STATISTICS**\n\n` +
                    `🏛️ Active Guilds: ${stats.guilds}\n` +
                    `🚫 Global Bans: ${stats.global_bans}\n` +
                    `📜 Pending Bills: ${stats.pending_bills}\n` +
                    `🤝 Avg Network Trust: ${Math.round(stats.avg_trust || 0)}/100`;

                const keyboard = {
                    inline_keyboard: [[{ text: "🔙 Indietro", callback_data: "g_menu" }]]
                };

                await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
            } catch (e) {
                console.error(e);
                await ctx.answerCallbackQuery("Error fetching stats");
            }
        }
        else if (data === "g_bills") {
            try {
                const bills = db.getDb().prepare("SELECT * FROM bills WHERE status = 'pending' LIMIT 5").all();

                let text = "";
                if (bills.length === 0) {
                    text = "📜 **Nessuna proposta in attesa**";
                } else {
                    text = "📜 **PENDING BILLS**\n\n";
                    bills.forEach(b => {
                        text += `#${b.id} ${b.type.toUpperCase()} -> ${b.target}\n`;
                    });
                }

                const keyboard = {
                    inline_keyboard: [[{ text: "🔙 Indietro", callback_data: "g_menu" }]]
                };

                await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
            } catch (e) {
                console.error("Error fetching bills:", e);
                await ctx.answerCallbackQuery("Error: " + e.message);
            }
        }
        else if (data === "g_config") {
            const text = "🛠️ **CONFIGURAZIONE**\n\nUsa `/setgstaff` nel gruppo parlamento o modifiche il file .env per i super admin.";
            const keyboard = {
                inline_keyboard: [[{ text: "🔙 Indietro", callback_data: "g_menu" }]]
            };
            await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
        }
        else if (data.startsWith("bl_link")) {
            // Todo implementation for wizard
            await ctx.answerCallbackQuery("TODO: Link Blacklist Wizard");
        }
        else if (data.startsWith("bl_word")) {
            await ctx.answerCallbackQuery("TODO: Word Blacklist Wizard");
        }
        else {
            return next();
        }
    });
}

function isSuperAdmin(userId) {
    const ids = (process.env.SUPER_ADMIN_IDS || '').split(',').map(s => parseInt(s.trim()));
    return ids.includes(userId);
}

/**
 * Generic helper to send log to Parliament topic and schedule auto-delete
 * @param {string} topicKey - Key in global_topics
 * @param {string} text - Message content
 */
async function sendGlobalLog(topicKey, text) {
    if (!db || !_botInstance) return;
    try {
        const globalConfig = db.getDb().prepare('SELECT * FROM global_config WHERE id = 1').get();
        if (!globalConfig || !globalConfig.parliament_group_id) return;

        let threadId = null;
        if (globalConfig.global_topics) {
            try {
                const topics = JSON.parse(globalConfig.global_topics);
                threadId = topics[topicKey];
            } catch (e) { }
        }

        const sent = await _botInstance.api.sendMessage(globalConfig.parliament_group_id, text, {
            message_thread_id: threadId,
            parse_mode: 'Markdown'
        });

        // Schedule auto-delete 24h
        const deleteAfter = new Date(Date.now() + 86400000).toISOString();
        db.getDb().prepare('INSERT INTO pending_deletions (message_id, chat_id, delete_after) VALUES (?, ?, ?)')
            .run(sent.message_id, sent.chat.id, deleteAfter);

    } catch (e) {
        console.error(`Failed to send global log (${topicKey})`, e.message);
    }
}

async function forwardBanToParliament(info) {
    if (!db || !_botInstance) return;
    try {
        const globalConfig = db.getDb().prepare('SELECT * FROM global_config WHERE id = 1').get();
        if (!globalConfig || !globalConfig.parliament_group_id) return;

        // Parse topics
        let threadId = null;
        if (globalConfig.global_topics) {
            try { threadId = JSON.parse(globalConfig.global_topics).bans; } catch (e) { }
        }

        const { user, guildName, guildId, reason, evidence, flux } = info;

        const text = `🔨 **BAN ESEGUITO**\n\n` +
            `🏛️ Gruppo: ${guildName}\n` +
            `👤 Utente: ${user.first_name} (@${user.username}) (ID: \`${user.id}\`)\n` +
            `📊 TrustFlux: ${flux}\n` +
            `⏰ Ora: ${new Date().toISOString()}\n\n` +
            `📝 Motivo: ${reason}\n` +
            `💬 Evidence: "${evidence ? evidence.substring(0, 200) : 'N/A'}"`;

        const keyboard = {
            inline_keyboard: [
                [{ text: "🌍 Global Ban", callback_data: `gban:${user.id}` }, { text: "✅ Solo Locale", callback_data: `gban_skip` }],
                [{ text: "➕ BL Link", callback_data: `bl_link` }, { text: "➕ BL Word", callback_data: `bl_word` }]
            ]
        };

        const sent = await _botInstance.api.sendMessage(globalConfig.parliament_group_id, text, {
            reply_markup: keyboard,
            parse_mode: 'Markdown',
            message_thread_id: threadId
        });

        // Schedule delete
        const deleteAfter = new Date(Date.now() + 86400000).toISOString();
        db.getDb().prepare('INSERT INTO pending_deletions (message_id, chat_id, delete_after) VALUES (?, ?, ?)')
            .run(sent.message_id, sent.chat.id, deleteAfter);

    } catch (e) {
        console.error("Failed to forward ban to parliament", e);
    }
}

async function executeGlobalBan(ctx, userId) {
    // 1. Mark user as global banned in DB
    db.setUserGlobalBan(userId, true);
    // 2. Log
    await ctx.editMessageCaption({ caption: ctx.callbackQuery.message.caption + "\n\n✅ **GLOBAL BANNED**" });
    // 3. (Optional) Broadcast to all guilds (not implemented here, costly)
    // 4. Update Global Flux
    db.getDb().prepare('UPDATE user_global_flux SET global_flux = -1000 WHERE user_id = ?').run(userId);
}

async function cleanupPendingDeletions() {
    if (!db || !_botInstance) return;
    try {
        const now = new Date().toISOString();
        const pending = db.getDb().prepare('SELECT * FROM pending_deletions WHERE delete_after < ?').all(now);

        for (const p of pending) {
            try {
                await _botInstance.api.deleteMessage(p.chat_id, p.message_id);
            } catch (e) {
                // If message already deleted or other error, ignore
            }
            db.getDb().prepare('DELETE FROM pending_deletions WHERE id = ?').run(p.id);
        }
    } catch (e) {
        console.error("Cleanup error", e);
    }
}

module.exports = { register, forwardBanToParliament, sendGlobalLog };
