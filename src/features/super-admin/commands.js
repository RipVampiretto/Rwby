const logic = require('./logic');
const ui = require('./ui');
const { isSuperAdmin, safeJsonParse } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');
const modalPatterns = require('../modal-patterns');

// Wizard Session Management
const WIZARD_SESSIONS = new Map();
const WIZARD_SESSION_TTL = 300000;

setInterval(() => {
    const now = Date.now();
    for (const [key, session] of WIZARD_SESSIONS.entries()) {
        if (now - session.startedAt > WIZARD_SESSION_TTL) {
            WIZARD_SESSIONS.delete(key);
        }
    }
}, 60000);

function registerCommands(bot, db) {
    // Command: /gpanel
    bot.command("gpanel", async (ctx) => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply("❌ Accesso negato");
        try {
            const stats = await logic.getStats(db);
            await ui.sendGovernancePanel(ctx, stats);
        } catch (e) {
            ctx.reply("❌ Error fetching stats");
        }
    });

    // Command: /setgstaff
    bot.command("setgstaff", async (ctx) => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply("❌ Accesso negato");
        if (ctx.chat.type === 'private') return ctx.reply("❌ Usalo nel gruppo Parliament.");

        try {
            await logic.setupParliament(db, ctx, bot);
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
            logger.error(`[super-admin] Setup error: ${e.message}`);
            ctx.reply("❌ Errore setup: " + e.message);
        }
    });

    // Command: /setglog
    bot.command("setglog", async (ctx) => {
        if (!isSuperAdmin(ctx.from.id)) return;
        await db.query(`
            INSERT INTO global_config (id, global_log_channel) VALUES (1, $1)
            ON CONFLICT(id) DO UPDATE SET global_log_channel = $1
        `, [ctx.chat.id]);
        await ctx.reply("✅ Global Log Channel impostato.");
    });

    // Command: /gwhitelist
    bot.command("gwhitelist", async (ctx) => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply("❌ Accesso negato");

        const args = ctx.message.text.split(' ').slice(1);
        const action = args[0];
        const domain = args[1];

        if (!action || action === 'list') {
            const items = await db.queryAll(
                "SELECT * FROM intel_data WHERE type = 'global_whitelist_domain' AND status = 'active'"
            );

            if (items.length === 0) {
                return ctx.reply("🔗 **WHITELIST DOMINI GLOBALE**\n\nNessun dominio in whitelist.");
            }

            let msg = "🔗 **WHITELIST DOMINI GLOBALE**\n\n";
            items.forEach((item, i) => {
                msg += `${i + 1}. \`${item.value}\`\n`;
            });
            msg += "\n_Usa /gwhitelist add <dominio> o /gwhitelist remove <dominio>_";
            return ctx.reply(msg, { parse_mode: 'Markdown' });
        }

        if (action === 'add' && domain) {
            const existing = await db.queryOne(
                "SELECT * FROM intel_data WHERE type = 'global_whitelist_domain' AND value = $1",
                [domain]
            );

            if (existing) {
                if (existing.status === 'active') {
                    return ctx.reply(`⚠️ \`${domain}\` è già in whitelist.`, { parse_mode: 'Markdown' });
                }
                await db.query("UPDATE intel_data SET status = 'active' WHERE id = $1", [existing.id]);
            } else {
                await db.query(
                    "INSERT INTO intel_data (type, value, added_by_user) VALUES ('global_whitelist_domain', $1, $2)",
                    [domain, ctx.from.id]
                );
            }
            return ctx.reply(`✅ \`${domain}\` aggiunto alla whitelist globale.`, { parse_mode: 'Markdown' });
        }

        if (action === 'remove' && domain) {
            const result = await db.query(
                "UPDATE intel_data SET status = 'removed' WHERE type = 'global_whitelist_domain' AND value = $1",
                [domain]
            );

            if (result.rowCount > 0) return ctx.reply(`🗑️ \`${domain}\` rimosso dalla whitelist globale.`, { parse_mode: 'Markdown' });
            return ctx.reply(`⚠️ \`${domain}\` non trovato in whitelist.`, { parse_mode: 'Markdown' });
        }

        return ctx.reply("❓ Uso: /gwhitelist [list|add|remove] [dominio]");
    });

    // Command: /gblacklist
    bot.command("gblacklist", async (ctx) => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply("❌ Accesso negato");
        const args = ctx.message.text.split(' ').slice(1);
        const action = args[0];
        const domain = args[1];

        if (!action || action === 'list') {
            const items = await db.queryAll(
                "SELECT * FROM intel_data WHERE type = 'blacklist_domain' AND status = 'active'"
            );
            if (items.length === 0) return ctx.reply("🚫 **BLACKLIST DOMINI GLOBALE**\n\nNessun dominio in blacklist.");

            let msg = "🚫 **BLACKLIST DOMINI GLOBALE**\n\n";
            items.forEach((item, i) => msg += `${i + 1}. \`${item.value}\`\n`);
            msg += "\n_Usa /gblacklist add <dominio> o /gblacklist remove <dominio>_";
            return ctx.reply(msg, { parse_mode: 'Markdown' });
        }

        if (action === 'add' && domain) {
            const existing = await db.queryOne("SELECT * FROM intel_data WHERE type = 'blacklist_domain' AND value = $1", [domain]);
            if (existing) {
                if (existing.status === 'active') return ctx.reply(`⚠️ \`${domain}\` già in blacklist.`);
                await db.query("UPDATE intel_data SET status='active' WHERE id=$1", [existing.id]);
            } else {
                await db.query("INSERT INTO intel_data (type, value, added_by_user) VALUES ('blacklist_domain', $1, $2)", [domain, ctx.from.id]);
            }
            return ctx.reply(`✅ \`${domain}\` aggiunto blacklist.`);
        }

        if (action === 'remove' && domain) {
            await db.query("UPDATE intel_data SET status='removed' WHERE type='blacklist_domain' AND value=$1", [domain]);
            return ctx.reply(`🗑️ \`${domain}\` rimosso.`);
        }

        return ctx.reply("❓ Uso: /gblacklist [list|add|remove] [dominio]");
    });

    // Command: /gscam
    bot.command("gscam", async (ctx) => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply("❌ Accesso negato");
        const args = ctx.message.text.split(' ').slice(1);
        const action = args[0];
        const pattern = args.slice(1).join(' ');

        if (!action || action === 'list') {
            const items = await db.queryAll("SELECT * FROM word_filters WHERE guild_id = 0 AND category = 'scam_pattern'");
            if (items.length === 0) return ctx.reply("🎯 **SCAM PATTERNS GLOBALI**\n\nNessun pattern.");
            let msg = "🎯 **SCAM PATTERNS GLOBALI**\n\n";
            items.forEach((item, i) => msg += `${i + 1}. \`${item.word}\`\n`);
            return ctx.reply(msg, { parse_mode: 'Markdown' });
        }

        if ((action === 'add' || action === 'addregex') && pattern) {
            const isRegex = action === 'addregex';
            if (isRegex) { try { new RegExp(pattern); } catch (e) { return ctx.reply("Regex invalida"); } }
            try {
                await db.query("INSERT INTO word_filters (guild_id, word, is_regex, category, action, bypass_tier) VALUES (0, $1, $2, 'scam_pattern', 'report_only', 2)", [pattern, isRegex]);
                return ctx.reply(`✅ Pattern aggiunto.`);
            } catch (e) { return ctx.reply("⚠️ Possibile duplicato."); }
        }

        if (action === 'remove' && pattern) {
            await db.query("DELETE FROM word_filters WHERE guild_id=0 AND category='scam_pattern' AND word=$1", [pattern]);
            return ctx.reply("🗑️ Rimosso.");
        }
        return ctx.reply("❓ Uso: /gscam [list|add|addregex|remove] [pattern]");
    });

    // Command: /gmodal
    bot.command("gmodal", async (ctx) => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply("❌ Accesso negato");
        const args = ctx.message.text.split(' ').slice(1);
        const action = args[0];
        const lang = args[1];
        const category = args[2];

        if (!action || action === 'list') {
            const modals = await modalPatterns.listModals(lang || null);
            if (modals.length === 0) return ctx.reply("📋 Nessun modal.");
            return ctx.reply(`📋 Trovati ${modals.length} modals (vedi logs o usa dettagli)`);
        }

        if (action === 'add') {
            const modalAction = args[3] || 'report_only';
            await modalPatterns.upsertModal(lang.toLowerCase(), category.toLowerCase(), [], modalAction, 0.6, ctx.from.id);
            return ctx.reply(`✅ Modal ${lang}/${category} creato.`);
        }

        if (action === 'addpattern') {
            const pattern = args.slice(3).join(' ');
            await modalPatterns.addPatternsToModal(lang.toLowerCase(), category.toLowerCase(), [pattern]);
            return ctx.reply("✅ Pattern aggiunto.");
        }
    });

    // Callback handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;

        const protectedPrefixes = ["gban", "g_", "bl_", "gwl_"];
        if (protectedPrefixes.some(p => data.startsWith(p)) && !isSuperAdmin(ctx.from.id)) {
            return ctx.answerCallbackQuery("❌ Accesso negato");
        }

        if (data === "g_close") return ctx.deleteMessage();

        if (data === "g_menu") {
            try {
                const stats = await logic.getStats(db);
                await ui.sendGovernancePanel(ctx, stats);
            } catch (e) { await ctx.answerCallbackQuery("Error reloading"); }
            return;
        }

        if (data === "g_stats") {
            const stats = await logic.getStats(db);
            await ui.sendFullStats(ctx, stats);
            return;
        }

        if (data.startsWith("gban:")) {
            const userId = data.split(":")[1];
            await ctx.answerCallbackQuery("🌍 Executing Global Ban...");
            await logic.executeGlobalBan(ctx, db, bot, userId);
        }

        if (data.startsWith("gban_skip:")) {
            await ctx.answerCallbackQuery("✅ Skipped");
            await ctx.deleteMessage();
        }

        if (data.startsWith("bl_link:")) {
            const parts = data.split(':');
            const domain = parts[1] || '';
            const origGuildId = parts[2] ? parseInt(parts[2]) : null;
            const origMsgId = parts[3] ? parseInt(parts[3]) : null;

            WIZARD_SESSIONS.set(ctx.from.id, {
                type: 'link', startedAt: Date.now(), prefillDomain: domain, origGuildId, origMsgId
            });
            await ctx.answerCallbackQuery("Wizard avviato");
            await ctx.reply(`🔗 **AGGIUNGI DOMINIO ALLA BLACKLIST**\n\nScrivi il dominio (es. ${domain || 'example.com'}):`, { reply_markup: { force_reply: true } });
        }
        else if (data === "bl_word") {
            WIZARD_SESSIONS.set(ctx.from.id, { type: 'word', startedAt: Date.now() });
            await ctx.answerCallbackQuery("Wizard avviato");
            await ctx.reply("🔤 **AGGIUNGI PAROLA**\n\nScrivi la parola:", { reply_markup: { force_reply: true } });
        }
        else if (data.startsWith("gwl_add:")) {
            const domain = data.split(":")[1];
            await db.query("INSERT INTO intel_data (type, value, added_by_user, status) VALUES ('global_whitelist_domain', $1, $2, 'active') ON CONFLICT DO NOTHING", [domain, ctx.from.id]);
            await ctx.answerCallbackQuery("✅ Whitelisted");
            await ctx.editMessageText(ctx.callbackQuery.message.text + `\n\n✅ **Aggiunto alla Whitelist**`, { parse_mode: 'Markdown' });
        }
        else return next();
    });

    // Wizard Listener
    bot.on("message:text", async (ctx, next) => {
        const userId = ctx.from.id;
        if (!WIZARD_SESSIONS.has(userId)) return next();
        const session = WIZARD_SESSIONS.get(userId);

        const input = ctx.message.text.trim();
        const type = session.type;

        try {
            if (type === 'link') {
                await db.query("INSERT INTO intel_data (type, value, added_by_user, status) VALUES ('blacklist_domain', $1, $2, 'active')", [input, userId]);
                await ctx.reply(`✅ Dominio \`${input}\` aggiunto alla Blacklist Globale.`);
                logger.info(`[super-admin] Global domain blacklist added: ${input}`);

                if (session.origGuildId && session.origMsgId) {
                    try { await bot.api.deleteMessage(session.origGuildId, session.origMsgId); } catch (e) { }
                }
            } else if (type === 'word') {
                await db.query("INSERT INTO intel_data (type, value, added_by_user, status) VALUES ('blacklist_word', $1, $2, 'active')", [input, userId]);
                await ctx.reply(`✅ Parola \`${input}\` aggiunta alla Blacklist Globale.`);
            }
            WIZARD_SESSIONS.delete(userId);
        } catch (e) {
            await ctx.reply("❌ Errore: " + e.message);
            WIZARD_SESSIONS.delete(userId);
        }
    });

}

module.exports = { registerCommands };
