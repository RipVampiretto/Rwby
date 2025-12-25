const logic = require('./logic');
const ui = require('./ui');
const { isSuperAdmin, safeJsonParse } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');
const spamPatterns = require('../spam-patterns');

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
    bot.command('gpanel', async ctx => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply('❌ Accesso negato');
        try {
            const stats = await logic.getStats(db);
            await ui.sendGovernancePanel(ctx, stats);
        } catch (e) {
            ctx.reply('❌ Error fetching stats');
        }
    });

    // Command: /setgstaff
    bot.command('setgstaff', async ctx => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply('❌ Accesso negato');
        if (ctx.chat.type === 'private') return ctx.reply('❌ Usalo nel gruppo Parliament.');

        try {
            await logic.setupParliament(db, ctx, bot);
            await ctx.reply(
                '✅ <b>Parliament Group Configurato</b>\n\n' +
                    'Creati i topic per:\n' +
                    '- Bans (Ban globali)\n' +
                    '- Logs (Sistema)\n' +
                    '- Join Logs (Ingressi)\n' +
                    '- Add Group (Nuovi gruppi)\n' +
                    '- Image Spam (Analisi AI)\n' +
                    '- Link Checks (Link checks)',
                { parse_mode: 'HTML' }
            );
        } catch (e) {
            logger.error(`[super-admin] Setup error: ${e.message}`);
            ctx.reply('❌ Errore setup: ' + e.message);
        }
    });

    // Command: /ungban <user_id>
    bot.command('ungban', async ctx => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply('❌ Accesso negato');

        const args = ctx.message.text.split(' ').slice(1);
        const userId = args[0];

        if (!userId || isNaN(userId)) {
            return ctx.reply('❓ Uso: <code>/ungban &lt;user_id&gt;</code>', { parse_mode: 'HTML' });
        }

        try {
            // Check if user is globally banned
            const user = await db.queryOne('SELECT * FROM users WHERE user_id = $1', [userId]);
            if (!user || !user.is_banned_global) {
                return ctx.reply(`⚠️ L'utente <code>${userId}</code> non è nella blacklist globale.`, {
                    parse_mode: 'HTML'
                });
            }

            // Remove global ban
            await db.query('UPDATE users SET is_banned_global = FALSE WHERE user_id = $1', [userId]);

            // Try to get user info
            let userName = 'Unknown';
            try {
                const userInfo = await bot.api.getChat(userId);
                userName = userInfo.first_name || 'Unknown';
            } catch (e) {}

            // Unban from all groups
            const guilds = await db.queryAll('SELECT guild_id FROM guild_config');
            let count = 0;
            for (const g of guilds) {
                try {
                    await bot.api.unbanChatMember(g.guild_id, userId, { only_if_banned: true });
                    count++;
                } catch (e) {}
            }

            await ctx.reply(
                `✅ <b>Global Unban eseguito</b>\n\n` +
                    `👤 Utente: ${userName} [<code>${userId}</code>]\n` +
                    `📊 Sbannato da: ${count} gruppi\n` +
                    `👮 Eseguito da: ${ctx.from.first_name}`,
                { parse_mode: 'HTML' }
            );

            logger.info(`[super-admin] Global Unban: ${userId} by ${ctx.from.id}`);
        } catch (e) {
            logger.error(`[super-admin] Ungban error: ${e.message}`);
            await ctx.reply('❌ Errore: ' + e.message);
        }
    });

    // Command: /gwhitelist
    bot.command('gwhitelist', async ctx => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply('❌ Accesso negato');

        const args = ctx.message.text.split(' ').slice(1);
        const action = args[0];
        const domain = args[1];

        if (!action || action === 'list') {
            const items = await db.queryAll("SELECT * FROM link_rules WHERE type = 'domain' AND action = 'allow'");

            if (items.length === 0) {
                return ctx.reply('🔗 <b>WHITELIST DOMINI GLOBALE</b>\n\nNessun dominio in whitelist.', {
                    parse_mode: 'HTML'
                });
            }

            let msg = '🔗 <b>WHITELIST DOMINI GLOBALE</b>\n\n';
            items.forEach((item, i) => {
                msg += `${i + 1}. <code>${item.pattern}</code>\n`;
            });
            msg += '\n<i>Usa /gwhitelist add <dominio> o /gwhitelist remove <dominio></i>';
            return ctx.reply(msg, { parse_mode: 'HTML' });
        }

        if (action === 'add' && domain) {
            const existing = await db.queryOne("SELECT * FROM link_rules WHERE type = 'domain' AND pattern = $1", [
                domain
            ]);

            if (existing) {
                if (existing.action === 'allow') {
                    return ctx.reply(`⚠️ <code>${domain}</code> è già in whitelist.`, { parse_mode: 'HTML' });
                }
                await db.query("UPDATE link_rules SET action = 'allow' WHERE id = $1", [existing.id]);
            } else {
                await db.query(
                    "INSERT INTO link_rules (pattern, type, action, added_by) VALUES ($1, 'domain', 'allow', $2)",
                    [domain, ctx.from.id]
                );
            }
            return ctx.reply(`✅ <code>${domain}</code> aggiunto alla whitelist globale.`, { parse_mode: 'HTML' });
        }

        if (action === 'remove' && domain) {
            const result = await db.query(
                "DELETE FROM link_rules WHERE type = 'domain' AND pattern = $1 AND action = 'allow'",
                [domain]
            );

            if (result.rowCount > 0)
                return ctx.reply(`🗑️ <code>${domain}</code> rimosso dalla whitelist globale.`, { parse_mode: 'HTML' });
            return ctx.reply(`⚠️ <code>${domain}</code> non trovato in whitelist.`, { parse_mode: 'HTML' });
        }

        return ctx.reply('❓ Uso: /gwhitelist [list|add|remove] [dominio]');
    });

    // Command: /gblacklist <w/d> <add/remove/list> <value>
    // w = word, d = domain
    bot.command('gblacklist', async ctx => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply('❌ Accesso negato');
        const args = ctx.message.text.split(' ').slice(1);
        const typeArg = args[0]?.toLowerCase(); // w or d
        const action = args[1]?.toLowerCase(); // add, remove, list
        const value = args.slice(2).join(' ');

        // Show help if no args or just 'list'
        if (!typeArg || typeArg === 'list') {
            const domains = await db.queryAll("SELECT * FROM link_rules WHERE type = 'domain' AND action = 'delete'");
            const words = await db.queryAll('SELECT * FROM word_filters');

            let msg = '🚫 <b>BLACKLIST GLOBALE</b>\n\n';

            msg += `<b>🔗 Domini (${domains.length}):</b>\n`;
            if (domains.length === 0) msg += '<i>Nessuno</i>\n';
            else domains.slice(0, 10).forEach((item, i) => (msg += `${i + 1}. <code>${item.pattern}</code>\n`));
            if (domains.length > 10) msg += `<i>...e altri ${domains.length - 10}</i>\n`;

            msg += `\n<b>🔤 Parole (${words.length}):</b>\n`;
            if (words.length === 0) msg += '<i>Nessuna</i>\n';
            else words.slice(0, 10).forEach((item, i) => (msg += `${i + 1}. <code>${item.word}</code>\n`));
            if (words.length > 10) msg += `<i>...e altre ${words.length - 10}</i>\n`;

            msg += '\n<b>Uso:</b>\n';
            msg += '<code>/gblacklist d add example.com</code> - Aggiungi dominio\n';
            msg += '<code>/gblacklist w add parola</code> - Aggiungi parola\n';
            msg += '<code>/gblacklist d remove example.com</code> - Rimuovi dominio\n';
            msg += '<code>/gblacklist w remove parola</code> - Rimuovi parola';
            return ctx.reply(msg, { parse_mode: 'HTML' });
        }

        // Determine type
        let tableName;
        let typeName;
        let column;

        if (typeArg === 'w' || typeArg === 'word') {
            tableName = 'word_filters';
            typeName = 'parola';
            column = 'word';
        } else if (typeArg === 'd' || typeArg === 'domain') {
            tableName = 'link_rules';
            typeName = 'dominio';
            column = 'pattern';
        } else {
            return ctx.reply('❌ Tipo non valido. Usa <code>w</code> (word) o <code>d</code> (domain).', {
                parse_mode: 'HTML'
            });
        }

        // List specific type
        if (action === 'list' || !action) {
            let sql = `SELECT * FROM ${tableName}`;
            if (tableName === 'link_rules') {
                sql += " WHERE type = 'domain' AND action = 'delete'";
            }

            const items = await db.queryAll(sql);
            if (items.length === 0) return ctx.reply(`🚫 Nessun ${typeName} in blacklist.`);

            let msg = `🚫 <b>BLACKLIST ${typeName.toUpperCase()}</b>\n\n`;
            items.forEach((item, i) => (msg += `${i + 1}. <code>${item[column]}</code>\n`));
            return ctx.reply(msg, { parse_mode: 'HTML' });
        }

        // Add
        if (action === 'add' && value) {
            if (tableName === 'link_rules') {
                const existing = await db.queryOne(`SELECT * FROM link_rules WHERE pattern = $1 AND type = 'domain'`, [
                    value
                ]);
                if (existing) {
                    if (existing.action === 'delete')
                        return ctx.reply(`⚠️ <code>${value}</code> già in blacklist.`, { parse_mode: 'HTML' });
                    await db.query("UPDATE link_rules SET action='delete' WHERE id=$1", [existing.id]);
                } else {
                    await db.query(
                        "INSERT INTO link_rules (pattern, type, action, added_by) VALUES ($1, 'domain', 'delete', $2)",
                        [value, ctx.from.id]
                    );
                }
            } else {
                // word_filters
                const existing = await db.queryOne(`SELECT * FROM word_filters WHERE word = $1`, [value]);
                if (existing) {
                    return ctx.reply(`⚠️ <code>${value}</code> già in blacklist.`, { parse_mode: 'HTML' });
                } else {
                    await db.query('INSERT INTO word_filters (word) VALUES ($1)', [value]);
                }
            }
            return ctx.reply(`✅ ${typeName} <code>${value}</code> aggiunto alla blacklist.`, { parse_mode: 'HTML' });
        }

        // Remove
        if (action === 'remove' && value) {
            let result;
            if (tableName === 'link_rules') {
                result = await db.query(
                    `DELETE FROM link_rules WHERE pattern = $1 AND type = 'domain' AND action = 'delete'`,
                    [value]
                );
            } else {
                result = await db.query(`DELETE FROM word_filters WHERE word = $1`, [value]);
            }

            if (result.rowCount > 0)
                return ctx.reply(`🗑️ ${typeName} <code>${value}</code> rimosso.`, { parse_mode: 'HTML' });
            return ctx.reply(`⚠️ <code>${value}</code> non trovato.`, { parse_mode: 'HTML' });
        }

        return ctx.reply('❓ Uso: <code>/gblacklist <w|d> <add|remove|list> [valore]</code>', { parse_mode: 'HTML' });
    });

    // Command: /gmodal
    bot.command('gmodal', async ctx => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply('❌ Accesso negato');
        const args = ctx.message.text.split(' ').slice(1);
        const action = args[0];
        const lang = args[1];
        const category = args[2];

        if (!action || action === 'list') {
            const modals = await spamPatterns.listModals(lang || null);
            if (modals.length === 0) return ctx.reply('📋 Nessun modal.');

            let msg = '📋 <b>MODALS</b>\n\n';
            for (const m of modals) {
                const hiddenIcon = m.hidden ? '👁️‍🗨️' : '👁️';
                const enabledIcon = m.enabled ? '✅' : '❌';
                msg += `${enabledIcon} ${hiddenIcon} <code>${m.language}/${m.category}</code>\n`;
            }
            msg += '\n<b>Azioni:</b>\n';
            msg += '<code>/gmodal add [lang] [cat]</code> - Crea modal\n';
            msg += '<code>/gmodal addpattern [lang] [cat] [testo]</code>\n';
            msg += '<code>/gmodal hide [lang] [cat]</code> - Toggle visibilità UI\n';
            msg += '<code>/gmodal toggle [lang] [cat]</code> - Toggle attivo/disattivo';
            return ctx.reply(msg, { parse_mode: 'HTML' });
        }

        if (action === 'add') {
            const modalAction = args[3] || 'report_only';
            await spamPatterns.upsertModal(
                lang.toLowerCase(),
                category.toLowerCase(),
                [],
                modalAction,
                0.6,
                ctx.from.id
            );
            return ctx.reply(`✅ Modal ${lang}/${category} creato.`);
        }

        if (action === 'addpattern') {
            const pattern = args.slice(3).join(' ');
            await spamPatterns.addPatternsToModal(lang.toLowerCase(), category.toLowerCase(), [pattern]);
            return ctx.reply('✅ Pattern aggiunto.');
        }

        if (action === 'hide') {
            if (!lang || !category) {
                return ctx.reply('❓ Uso: <code>/gmodal hide [lang] [category]</code>', { parse_mode: 'HTML' });
            }
            const newState = await spamPatterns.toggleModalHidden(lang.toLowerCase(), category.toLowerCase());
            if (newState === null) {
                return ctx.reply('❌ Modal non trovato.');
            }
            const icon = newState ? '👁️‍🗨️ Nascosto' : '👁️ Visibile';
            return ctx.reply(`${icon}: <code>${lang}/${category}</code>`, { parse_mode: 'HTML' });
        }

        if (action === 'toggle') {
            if (!lang || !category) {
                return ctx.reply('❓ Uso: <code>/gmodal toggle [lang] [category]</code>', { parse_mode: 'HTML' });
            }
            const newState = await spamPatterns.toggleModal(lang.toLowerCase(), category.toLowerCase());
            if (newState === null) {
                return ctx.reply('❌ Modal non trovato.');
            }
            const icon = newState ? '✅ Attivo' : '❌ Disattivo';
            return ctx.reply(`${icon}: <code>${lang}/${category}</code>`, { parse_mode: 'HTML' });
        }
    });

    // Callback handlers
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;

        const protectedPrefixes = ['gban', 'g_', 'bl_', 'gwl_'];
        if (protectedPrefixes.some(p => data.startsWith(p)) && !isSuperAdmin(ctx.from.id)) {
            return ctx.answerCallbackQuery('❌ Accesso negato');
        }

        if (data === 'g_close') return ctx.deleteMessage();

        if (data === 'g_menu') {
            try {
                const stats = await logic.getStats(db);
                await ui.sendGovernancePanel(ctx, stats);
            } catch (e) {
                await ctx.answerCallbackQuery('Error reloading');
            }
            return;
        }

        if (data === 'g_stats') {
            const stats = await logic.getStats(db);
            await ui.sendFullStats(ctx, stats);
            return;
        }

        if (data.startsWith('gban:')) {
            const userId = data.split(':')[1];
            await ctx.answerCallbackQuery('🌍 Executing Global Ban...');
            await logic.executeGlobalBan(ctx, db, bot, userId);
        }

        if (data.startsWith('gban_skip:')) {
            await ctx.answerCallbackQuery('✅ Skipped');
            await ctx.deleteMessage();
        }

        if (data === 'parl_dismiss') {
            await ctx.answerCallbackQuery('✅ Ignorato');
            await ctx.deleteMessage();
        }

        if (data.startsWith('wl_domain:')) {
            const domain = data.split(':')[1];
            if (!domain) return ctx.answerCallbackQuery('❌ Dominio non valido');

            await db.query(
                "INSERT INTO link_rules (pattern, type, action, added_by) VALUES ($1, 'domain', 'allow', $2) ON CONFLICT DO NOTHING",
                [domain, ctx.from.id]
            );
            await ctx.answerCallbackQuery('✅ Whitelisted');
            await ctx.editMessageText(
                ctx.callbackQuery.message.text + `\n\n✅ <b>${domain} aggiunto alla Whitelist</b>`,
                {
                    parse_mode: 'HTML'
                }
            );
        }

        if (data.startsWith('bl_domain:')) {
            const domain = data.split(':')[1];
            if (!domain) return ctx.answerCallbackQuery('❌ Dominio non valido');

            await db.query(
                "INSERT INTO link_rules (pattern, type, action, added_by) VALUES ($1, 'domain', 'delete', $2) ON CONFLICT DO NOTHING",
                [domain, ctx.from.id]
            );
            await ctx.answerCallbackQuery('🚫 Blacklisted');
            await ctx.editMessageText(
                ctx.callbackQuery.message.text + `\n\n🚫 <b>${domain} aggiunto alla Blacklist</b>`,
                {
                    parse_mode: 'HTML'
                }
            );
        }

        if (data.startsWith('bl_link:')) {
            const parts = data.split(':');
            const domain = parts[1] || '';
            const origGuildId = parts[2] ? parseInt(parts[2]) : null;
            const origMsgId = parts[3] ? parseInt(parts[3]) : null;

            WIZARD_SESSIONS.set(ctx.from.id, {
                type: 'link',
                startedAt: Date.now(),
                prefillDomain: domain,
                origGuildId,
                origMsgId
            });
            await ctx.answerCallbackQuery('Wizard avviato');
            await ctx.reply(
                `🔗 <b>AGGIUNGI DOMINIO ALLA BLACKLIST</b>\n\nScrivi il dominio (es. ${domain || 'example.com'}):`,
                { parse_mode: 'HTML', reply_markup: { force_reply: true } }
            );
        } else if (data === 'bl_word') {
            WIZARD_SESSIONS.set(ctx.from.id, { type: 'word', startedAt: Date.now() });
            await ctx.answerCallbackQuery('Wizard avviato');
            await ctx.reply('🔤 <b>AGGIUNGI PAROLA</b>\n\nScrivi la parola:', {
                parse_mode: 'HTML',
                reply_markup: { force_reply: true }
            });
        } else if (data.startsWith('gwl_add:')) {
            const domain = data.split(':')[1];
            await db.query(
                "INSERT INTO link_rules (pattern, type, action, added_by) VALUES ($1, 'domain', 'allow', $2) ON CONFLICT DO NOTHING",
                [domain, ctx.from.id]
            );
            await ctx.answerCallbackQuery('✅ Whitelisted');
            await ctx.editMessageText(ctx.callbackQuery.message.text + `\n\n✅ <b>Aggiunto alla Whitelist</b>`, {
                parse_mode: 'HTML'
            });
        } else return next();
    });

    // Wizard Listener
    bot.on('message:text', async (ctx, next) => {
        const userId = ctx.from.id;
        if (!WIZARD_SESSIONS.has(userId)) return next();
        const session = WIZARD_SESSIONS.get(userId);

        const input = ctx.message.text.trim();
        const type = session.type;

        try {
            if (type === 'link') {
                await db.query(
                    "INSERT INTO link_rules (pattern, type, action, added_by) VALUES ($1, 'domain', 'delete', $2)",
                    [input, userId]
                );
                await ctx.reply(`✅ Dominio <code>${input}</code> aggiunto alla Blacklist Globale.`, {
                    parse_mode: 'HTML'
                });
                logger.info(`[super-admin] Global domain blacklist added: ${input}`);

                if (session.origGuildId && session.origMsgId) {
                    try {
                        await bot.api.deleteMessage(session.origGuildId, session.origMsgId);
                    } catch (e) {}
                }
            } else if (type === 'word') {
                await db.query('INSERT INTO word_filters (word) VALUES ($1)', [input]);
                await ctx.reply(`✅ Parola <code>${input}</code> aggiunta alla Blacklist Globale.`, {
                    parse_mode: 'HTML'
                });
            }
            WIZARD_SESSIONS.delete(userId);
        } catch (e) {
            await ctx.reply('❌ Errore: ' + e.message);
            WIZARD_SESSIONS.delete(userId);
        }
    });
}

module.exports = { registerCommands };
