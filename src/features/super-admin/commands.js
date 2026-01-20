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

    // Command: /fixrestricted - Restore restricted users to normal member status
    bot.command('fixrestricted', async ctx => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply('❌ Accesso negato');

        const args = ctx.message.text.split(' ').slice(1);
        const targetGuildId = args[0];

        if (!targetGuildId) {
            return ctx.reply(
                '🔧 <b>Fix Restricted Users</b>\n\n' +
                'Ripristina TUTTI gli utenti "restricted" ai permessi normali del gruppo.\n' +
                'Esclude solo gli utenti bannati (kicked).\n\n' +
                '<b>Uso:</b>\n' +
                '<code>/fixrestricted [guild_id]</code> - Fix per un gruppo specifico\n' +
                '<code>/fixrestricted all</code> - Fix per tutti i gruppi',
                { parse_mode: 'HTML' }
            );
        }

        const statusMsg = await ctx.reply('🔄 Avvio processo di ripristino... Questo potrebbe richiedere tempo.');

        try {
            let guilds = [];
            if (targetGuildId === 'all') {
                guilds = await db.queryAll('SELECT guild_id FROM guild_config WHERE captcha_enabled = TRUE');
                logger.info(`[super-admin] fixrestricted: Processing ${guilds.length} groups with captcha enabled`);
            } else {
                guilds = [{ guild_id: parseInt(targetGuildId) }];
            }

            // Get ALL known users from database
            const allUsers = await db.queryAll('SELECT DISTINCT user_id FROM users');
            logger.info(`[super-admin] fixrestricted: Checking ${allUsers.length} known users across ${guilds.length} groups`);

            let totalFixed = 0;
            let totalErrors = 0;
            let totalSkipped = 0;
            let groupsProcessed = 0;

            for (const guild of guilds) {
                try {
                    // Get chat info and default permissions
                    const chat = await bot.api.getChat(guild.guild_id);
                    const defaultPerms = chat.permissions || {};
                    const chatTitle = chat.title || guild.guild_id;

                    let guildFixed = 0;

                    for (const user of allUsers) {
                        try {
                            const member = await bot.api.getChatMember(guild.guild_id, user.user_id);

                            // Skip banned users (kicked status)
                            if (member.status === 'kicked') {
                                totalSkipped++;
                                continue;
                            }

                            // Fix ALL "restricted" members (regardless of permissions)
                            if (member.status === 'restricted') {
                                // Per Telegram API: "Pass True for all permissions to lift restrictions"
                                await bot.api.restrictChatMember(guild.guild_id, user.user_id, {
                                    can_send_messages: true,
                                    can_send_audios: true,
                                    can_send_documents: true,
                                    can_send_photos: true,
                                    can_send_videos: true,
                                    can_send_video_notes: true,
                                    can_send_voice_notes: true,
                                    can_send_polls: true,
                                    can_send_other_messages: true,
                                    can_add_web_page_previews: true,
                                    can_change_info: true,
                                    can_invite_users: true,
                                    can_pin_messages: true,
                                    can_manage_topics: true
                                });

                                guildFixed++;
                                totalFixed++;
                                logger.debug(`[super-admin] Fixed restricted user ${user.user_id} in ${guild.guild_id}`);
                            }
                        } catch (e) {
                            // User not in chat or other error - skip silently
                        }

                        // Rate limit protection (50ms between API calls)
                        await new Promise(r => setTimeout(r, 50));
                    }

                    if (guildFixed > 0) {
                        logger.info(`[super-admin] Fixed ${guildFixed} users in ${chatTitle} (${guild.guild_id})`);
                    }
                    groupsProcessed++;

                    // Update status message periodically
                    if (groupsProcessed % 5 === 0) {
                        await ctx.api.editMessageText(
                            ctx.chat.id,
                            statusMsg.message_id,
                            `🔄 <b>Ripristino in corso...</b>\n\n` +
                            `📊 Gruppi: ${groupsProcessed}/${guilds.length}\n` +
                            `👤 Utenti ripristinati: ${totalFixed}`,
                            { parse_mode: 'HTML' }
                        ).catch(() => { });
                    }

                } catch (e) {
                    totalErrors++;
                    logger.error(`[super-admin] Error processing guild ${guild.guild_id}: ${e.message}`);
                }
            }

            await ctx.api.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                `✅ <b>Ripristino completato</b>\n\n` +
                `📊 Gruppi processati: ${groupsProcessed}\n` +
                `👤 Utenti controllati: ${allUsers.length}\n` +
                `✅ Utenti ripristinati: ${totalFixed}\n` +
                `⏭️ Bannati saltati: ${totalSkipped}\n` +
                `❌ Errori: ${totalErrors}`,
                { parse_mode: 'HTML' }
            );

            logger.info(`[super-admin] fixrestricted completed: ${totalFixed} users fixed, ${totalSkipped} skipped, ${totalErrors} errors`);

        } catch (e) {
            logger.error(`[super-admin] fixrestricted error: ${e.message}`);
            await ctx.api.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                `❌ Errore: ${e.message}`,
                { parse_mode: 'HTML' }
            );
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

            // Remove global ban from database
            await db.query('UPDATE users SET is_banned_global = FALSE WHERE user_id = $1', [userId]);

            // Remove from local gban cache
            const detection = require('../global-blacklist/detection');
            detection.removeFromLocalCache(parseInt(userId));

            // Try to get user info
            let userName = 'Unknown';
            try {
                const userInfo = await bot.api.getChat(userId);
                userName = userInfo.first_name || 'Unknown';
            } catch (e) { }

            // Unban from all groups
            const guilds = await db.queryAll('SELECT guild_id FROM guild_config');
            let count = 0;
            for (const g of guilds) {
                try {
                    await bot.api.unbanChatMember(g.guild_id, userId, { only_if_banned: true });
                    count++;
                } catch (e) { }
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

    // Command: /gban <user_id> or reply to message
    bot.command('gban', async ctx => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply('❌ Accesso negato');

        let userIds = [];
        const replyMsg = ctx.message.reply_to_message;

        if (replyMsg) {
            // Reply mode: get user ID from replied message
            if (replyMsg.from?.id) userIds.push(replyMsg.from.id);
        } else {
            // Args mode: /gban <user_id> <user_id> ...
            const args = ctx.message.text.split(' ').slice(1);
            userIds = args.filter(id => id && !isNaN(id));
        }

        if (userIds.length === 0) {
            return ctx.reply(
                '❓ <b>Uso:</b>\n' +
                '• Rispondi a un messaggio con <code>/gban</code>\n' +
                '• <code>/gban &lt;user_id&gt; [&lt;user_id&gt; ...]</code>\n\n' +
                '<b>Esempio:</b>\n' +
                '<code>/gban 123456789 987654321</code>',
                { parse_mode: 'HTML' }
            );
        }

        try {
            // Delete the original message if in reply mode
            if (replyMsg) {
                try {
                    await bot.api.deleteMessage(ctx.chat.id, replyMsg.message_id);
                } catch (e) {
                    logger.error(`[super-admin] Could not delete message: ${e.message}`);
                }
            }

            // Delete the command message
            try {
                await bot.api.deleteMessage(ctx.chat.id, ctx.message.message_id);
            } catch (e) { }

            const detection = require('../global-blacklist/detection');
            const { queueBanNotification } = require('../global-blacklist/actions');
            const guilds = await db.queryAll('SELECT guild_id, guild_name FROM guild_config');

            let results = [];

            for (const userId of userIds) {
                // Update database to set is_banned_global = TRUE
                await db.query('UPDATE users SET is_banned_global = TRUE WHERE user_id = $1', [userId]);
                detection.addToLocalCache(parseInt(userId));

                // Try to get user info for logging
                let targetUser = { id: userId, first_name: 'Unknown' };
                try {
                    const userInfo = await bot.api.getChat(userId);
                    targetUser = {
                        id: userId,
                        first_name: userInfo.first_name || 'Unknown',
                        username: userInfo.username
                    };
                } catch (e) {
                    // User info not available, use default
                }

                let count = 0;
                for (const g of guilds) {
                    try {
                        await bot.api.banChatMember(g.guild_id, userId);
                        count++;
                        // Send aggregated notification if blacklist_notify is enabled for this guild
                        const config = await db.getGuildConfig(g.guild_id);
                        if (config && config.blacklist_notify && config.log_channel_id) {
                            queueBanNotification(
                                config.log_channel_id,
                                targetUser,
                                { id: g.guild_id, title: g.guild_name || `Group ${g.guild_id}` },
                                `Global Ban by ${ctx.from.first_name}`
                            );
                        }
                    } catch (e) {
                        // User might not be in this group or bot lacks permissions
                    }
                }
                results.push({ user: targetUser, count });
                logger.info(`[super-admin] Global Ban: ${userId} by ${ctx.from.id}`);
            }

            // Send confirmation message
            let confirmText = `🌍 <b>Global Ban eseguito</b>\n\n`;
            for (const r of results) {
                confirmText += `👤 Utente: ${r.user.first_name} [<code>${r.user.id}</code>]\n`;
                confirmText += `📊 Bannato da: ${r.count} gruppi\n\n`;
            }
            confirmText += `👮 Eseguito da: ${ctx.from.first_name}`;

            const confirmMsg = await ctx.reply(confirmText, { parse_mode: 'HTML' });

            // Auto-delete confirmation after 5 seconds if NOT in Parliament group
            const globalConfig = await db.queryOne('SELECT parliament_group_id FROM global_config WHERE id = 1');
            if (globalConfig && ctx.chat.id !== globalConfig.parliament_group_id) {
                setTimeout(async () => {
                    try {
                        await bot.api.deleteMessage(ctx.chat.id, confirmMsg.message_id);
                    } catch (e) {
                        // Message might already be deleted
                    }
                }, 5000);
            }
        } catch (e) {
            logger.error(`[super-admin] Gban error: ${e.message}`);
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

    // Command: /gfeature - Manage global feature flags
    bot.command('gfeature', async ctx => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply('❌ Accesso negato');
        const gating = require('../feature-gating');
        const args = ctx.message.text.split(' ').slice(1);
        const action = args[0]?.toLowerCase();

        // List all features
        if (!action || action === 'list') {
            const features = await gating.getAllFeatureFlags();
            let msg = '🎛️ <b>FEATURE FLAGS GLOBALI</b>\n\n';
            for (const f of features) {
                const status = f.enabledByDefault ? '✅' : '❌';
                msg += `${status} ${f.emoji} <code>${f.name}</code>\n`;
            }
            msg += '\n<b>Comandi:</b>\n';
            msg += '<code>/gfeature toggle [feature]</code> - Toggle globale\n';
            msg += '<code>/gfeature allow [guild_id] [feature]</code> - Abilita per gruppo\n';
            msg += '<code>/gfeature block [guild_id] [feature]</code> - Blocca per gruppo\n';
            msg += '<code>/gfeature unblock [guild_id] [feature]</code> - Rimuovi override\n';
            msg += '<code>/gfeature status [guild_id]</code> - Stato gruppo';
            return ctx.reply(msg, { parse_mode: 'HTML' });
        }

        // Toggle global default
        if (action === 'toggle') {
            const featureName = args[1]?.toLowerCase();
            if (!featureName) {
                return ctx.reply('❓ Uso: <code>/gfeature toggle [feature_name]</code>', { parse_mode: 'HTML' });
            }
            const features = await gating.getAllFeatureFlags();
            const feature = features.find(f => f.name === featureName);
            if (!feature) {
                return ctx.reply(`❌ Feature non trovata: <code>${featureName}</code>`, { parse_mode: 'HTML' });
            }
            const newState = !feature.enabledByDefault;
            await gating.setFeatureDefault(featureName, newState);
            const icon = newState ? '✅ Attivata' : '❌ Disattivata';
            return ctx.reply(`${icon} globalmente: <code>${featureName}</code>`, { parse_mode: 'HTML' });
        }

        // Block feature for specific guild
        if (action === 'block') {
            const guildId = args[1];
            const featureName = args[2]?.toLowerCase();
            const reason = args.slice(3).join(' ') || 'No reason';

            if (!guildId || !featureName) {
                return ctx.reply('❓ Uso: <code>/gfeature block [guild_id] [feature] [reason]</code>', {
                    parse_mode: 'HTML'
                });
            }

            await gating.setGuildFeatureAccess(parseInt(guildId), featureName, false, reason, ctx.from.id);
            return ctx.reply(
                `🚫 Feature <code>${featureName}</code> bloccata per gruppo <code>${guildId}</code>\n` +
                `📝 Motivo: ${reason}`,
                { parse_mode: 'HTML' }
            );
        }

        // Allow feature for specific guild (even if globally disabled)
        if (action === 'allow') {
            const guildId = args[1];
            const featureName = args[2]?.toLowerCase();
            const reason = args.slice(3).join(' ') || 'Manual allow';

            if (!guildId || !featureName) {
                return ctx.reply('❓ Uso: <code>/gfeature allow [guild_id] [feature] [reason]</code>', {
                    parse_mode: 'HTML'
                });
            }

            await gating.setGuildFeatureAccess(parseInt(guildId), featureName, true, reason, ctx.from.id);
            return ctx.reply(
                `✅ Feature <code>${featureName}</code> abilitata per gruppo <code>${guildId}</code>\n` +
                `📝 Motivo: ${reason}`,
                { parse_mode: 'HTML' }
            );
        }

        // Unblock feature for specific guild
        if (action === 'unblock') {
            const guildId = args[1];
            const featureName = args[2]?.toLowerCase();

            if (!guildId || !featureName) {
                return ctx.reply('❓ Uso: <code>/gfeature unblock [guild_id] [feature]</code>', { parse_mode: 'HTML' });
            }

            await gating.removeGuildFeatureAccess(parseInt(guildId), featureName);
            return ctx.reply(`✅ Override rimosso per <code>${featureName}</code> in gruppo <code>${guildId}</code>`, {
                parse_mode: 'HTML'
            });
        }

        // Check guild status
        if (action === 'status') {
            const guildId = args[1];
            if (!guildId) {
                return ctx.reply('❓ Uso: <code>/gfeature status [guild_id]</code>', { parse_mode: 'HTML' });
            }

            const overrides = await gating.getGuildFeatureOverrides(parseInt(guildId));
            const blacklisted = await gating.isGuildBlacklisted(parseInt(guildId));

            let msg = `📊 <b>STATUS GRUPPO</b> <code>${guildId}</code>\n\n`;

            if (blacklisted) {
                msg += `⛔ <b>BLACKLISTED</b>\n`;
                msg += `📝 Motivo: ${blacklisted.reason}\n`;
                msg += `📅 Dal: ${new Date(blacklisted.blacklisted_at).toLocaleDateString('it-IT')}\n\n`;
            }

            if (overrides.length === 0) {
                msg += 'Nessun override specifico.';
            } else {
                msg += '<b>Override:</b>\n';
                for (const o of overrides) {
                    const status = o.is_allowed ? '✅' : '🚫';
                    msg += `${status} <code>${o.feature_name}</code>`;
                    if (o.reason) msg += ` - ${o.reason}`;
                    msg += '\n';
                }
            }
            return ctx.reply(msg, { parse_mode: 'HTML' });
        }

        return ctx.reply('❓ Azione non valida. Usa /gfeature list per vedere le opzioni.');
    });

    // Command: /gblacklist - Manage group blacklist (renamed to avoid conflict with word blacklist)
    bot.command('guildblacklist', async ctx => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply('❌ Accesso negato');
        const gating = require('../feature-gating');
        const args = ctx.message.text.split(' ').slice(1);
        const action = args[0]?.toLowerCase();

        // List blacklisted groups
        if (!action || action === 'list') {
            const guilds = await gating.getBlacklistedGuilds();
            if (guilds.length === 0) {
                return ctx.reply('✅ Nessun gruppo in blacklist.');
            }
            let msg = '⛔ <b>GRUPPI IN BLACKLIST</b>\n\n';
            for (const g of guilds) {
                const name = g.guild_name || 'Unknown';
                const expires = g.expires_at ? new Date(g.expires_at).toLocaleDateString('it-IT') : 'Mai';
                msg += `• <code>${g.guild_id}</code> (${name})\n`;
                msg += `  📝 ${g.reason}\n`;
                msg += `  ⏰ Scade: ${expires}\n\n`;
            }
            return ctx.reply(msg, { parse_mode: 'HTML' });
        }

        // Add to blacklist
        if (action === 'add') {
            const guildId = args[1];
            const days = !isNaN(args[args.length - 1]) ? parseInt(args[args.length - 1]) : null;
            const reasonParts = days ? args.slice(2, -1) : args.slice(2);
            const reason = reasonParts.join(' ') || 'No reason';

            if (!guildId) {
                return ctx.reply('❓ Uso: <code>/guildblacklist add [guild_id] [reason] [days]</code>', {
                    parse_mode: 'HTML'
                });
            }

            await gating.blacklistGuild(parseInt(guildId), reason, ctx.from.id, days);
            const expiresText = days ? `${days} giorni` : 'permanente';
            return ctx.reply(
                `⛔ Gruppo <code>${guildId}</code> aggiunto alla blacklist\n` +
                `📝 Motivo: ${reason}\n` +
                `⏰ Durata: ${expiresText}`,
                { parse_mode: 'HTML' }
            );
        }

        // Remove from blacklist
        if (action === 'remove') {
            const guildId = args[1];
            if (!guildId) {
                return ctx.reply('❓ Uso: <code>/guildblacklist remove [guild_id]</code>', { parse_mode: 'HTML' });
            }

            await gating.unblacklistGuild(parseInt(guildId));
            return ctx.reply(`✅ Gruppo <code>${guildId}</code> rimosso dalla blacklist.`, { parse_mode: 'HTML' });
        }

        return ctx.reply('❓ Uso: <code>/guildblacklist [list|add|remove]</code>', { parse_mode: 'HTML' });
    });

    // Command: /gdelete <chat_id> <message_id> - Delete a message in any chat
    // Also works in reply to a message (including service messages)
    bot.command('gdelete', async ctx => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply('❌ Accesso negato');

        let chatId, messageId;
        const replyMsg = ctx.message.reply_to_message;

        if (replyMsg) {
            // Reply mode: delete the replied message
            chatId = ctx.chat.id;
            messageId = replyMsg.message_id;
        } else {
            // Args mode: /gdelete <chat_id> <message_id>
            const args = ctx.message.text.split(' ').slice(1);
            chatId = args[0];
            messageId = args[1];
        }

        if (!chatId || !messageId) {
            return ctx.reply(
                '❓ <b>Uso:</b>\n' +
                '• Rispondi a un messaggio con <code>/gdelete</code>\n' +
                '• <code>/gdelete &lt;chat_id&gt; &lt;message_id&gt;</code>\n\n' +
                '<b>Esempio:</b>\n' +
                '<code>/gdelete -1001234567890 12345</code>',
                { parse_mode: 'HTML' }
            );
        }

        try {
            await bot.api.deleteMessage(chatId, parseInt(messageId));
            const confirmMsg = await ctx.reply(
                `✅ <b>Messaggio eliminato</b>\n\n` +
                `📍 Chat: <code>${chatId}</code>\n` +
                `🆔 Message ID: <code>${messageId}</code>`,
                { parse_mode: 'HTML' }
            );
            logger.info(`[super-admin] Message ${messageId} deleted from ${chatId} by ${ctx.from.id}`);

            // Auto-delete confirmation after 10 seconds
            setTimeout(async () => {
                try {
                    await bot.api.deleteMessage(ctx.chat.id, confirmMsg.message_id);
                } catch (e) { }
            }, 10000);
        } catch (e) {
            const errMsg = await ctx.reply(`❌ Errore: ${e.message}`);
            logger.error(`[super-admin] gdelete error: ${e.message}`);
            setTimeout(async () => {
                try {
                    await bot.api.deleteMessage(ctx.chat.id, errMsg.message_id);
                } catch (e) { }
            }, 10000);
        }
    });

    // Command: /gunmute <chat_id> <user_id> - Unmute/unrestrict a user in any chat
    // Also works in reply to a message (including service messages like join/leave)
    bot.command('gunmute', async ctx => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply('❌ Accesso negato');

        let chatId, userId;
        const replyMsg = ctx.message.reply_to_message;

        if (replyMsg) {
            // Reply mode: unmute the user from the replied message
            chatId = ctx.chat.id;

            // Try to get user from service message first, then fallback to from
            if (replyMsg.new_chat_members && replyMsg.new_chat_members.length > 0) {
                // Service message: user joined
                userId = replyMsg.new_chat_members[0].id;
            } else if (replyMsg.left_chat_member) {
                // Service message: user left
                userId = replyMsg.left_chat_member.id;
            } else if (replyMsg.from) {
                // Regular message
                userId = replyMsg.from.id;
            }
        } else {
            // Args mode: /gunmute <chat_id> <user_id>
            const args = ctx.message.text.split(' ').slice(1);
            chatId = args[0];
            userId = args[1];
        }

        if (!chatId || !userId) {
            return ctx.reply(
                '❓ <b>Uso:</b>\n' +
                '• Rispondi a un messaggio con <code>/gunmute</code>\n' +
                '• <code>/gunmute &lt;chat_id&gt; &lt;user_id&gt;</code>\n\n' +
                '<b>Esempio:</b>\n' +
                '<code>/gunmute -1001234567890 123456789</code>',
                { parse_mode: 'HTML' }
            );
        }

        try {
            await bot.api.restrictChatMember(chatId, parseInt(userId), {
                can_send_messages: true,
                can_send_audios: true,
                can_send_documents: true,
                can_send_photos: true,
                can_send_videos: true,
                can_send_video_notes: true,
                can_send_voice_notes: true,
                can_send_polls: true,
                can_send_other_messages: true,
                can_add_web_page_previews: true,
                can_change_info: false,
                can_invite_users: true,
                can_pin_messages: false,
                can_manage_topics: false
            });

            // Try to get user info
            let userName = 'Unknown';
            try {
                const userInfo = await bot.api.getChat(userId);
                userName = userInfo.first_name || 'Unknown';
            } catch (e) { }

            const confirmMsg = await ctx.reply(
                `✅ <b>Utente smutato</b>\n\n` +
                `👤 Utente: ${userName} [<code>${userId}</code>]\n` +
                `📍 Chat: <code>${chatId}</code>`,
                { parse_mode: 'HTML' }
            );
            logger.info(`[super-admin] User ${userId} unmuted in ${chatId} by ${ctx.from.id}`);

            // Auto-delete confirmation after 10 seconds
            setTimeout(async () => {
                try {
                    await bot.api.deleteMessage(ctx.chat.id, confirmMsg.message_id);
                } catch (e) { }
            }, 10000);
        } catch (e) {
            const errMsg = await ctx.reply(`❌ Errore: ${e.message}`);
            logger.error(`[super-admin] gunmute error: ${e.message}`);
            setTimeout(async () => {
                try {
                    await bot.api.deleteMessage(ctx.chat.id, errMsg.message_id);
                } catch (e) { }
            }, 10000);
        }
    });

    // Command: /leave [chat_id] - Leave the current or specified group
    bot.command('leave', async ctx => {
        if (!isSuperAdmin(ctx.from.id)) return ctx.reply('❌ Accesso negato');

        let chatId = ctx.chat.id;
        const args = ctx.message.text.split(' ').slice(1);

        if (args.length > 0) {
            chatId = args[0];
        } else if (ctx.chat.type === 'private') {
            return ctx.reply('❓ Specifica un ID gruppo: /leave <chat_id>');
        }

        try {
            // Get chat info to confirm command
            let chatName = chatId;
            try {
                const chat = await bot.api.getChat(chatId);
                chatName = chat.title || chat.username || chatId;
            } catch (e) {
                // Ignore if bot cannot see chat details
            }

            // Send goodbye message if possible
            try {
                await bot.api.sendMessage(chatId, '👋 Bye!');
            } catch (e) {
                // Ignore failure to send message
            }

            await bot.api.leaveChat(chatId);

            await ctx.reply(`✅ Lasciato il gruppo: ${chatName} (${chatId})`);
            logger.info(`[super-admin] Bot left ${chatId} requested by ${ctx.from.id}`);

        } catch (e) {
            logger.error(`[super-admin] Leave error: ${e.message}`);
            ctx.reply(`❌ Errore: ${e.message}`);
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

        // Analytics handlers
        if (data === 'g_analytics' || data.startsWith('g_analytics:')) {
            try {
                const monthlyStats = require('../analytics/monthly-stats');
                let monthYear;

                if (data === 'g_analytics') {
                    monthYear = monthlyStats.getCurrentMonthYear();
                } else {
                    monthYear = data.split(':')[1];
                }

                const stats = await monthlyStats.getMonthlyStats(db, monthYear);
                const prevMonth = monthlyStats.getPreviousMonth(monthYear);
                const prevStats = await monthlyStats.getMonthlyStats(db, prevMonth, false);

                await ui.sendMonthlyAnalytics(ctx, stats || {}, monthYear, prevStats);
                await ctx.answerCallbackQuery();
            } catch (e) {
                logger.error(`[super-admin] Analytics error: ${e.message}`);
                await ctx.answerCallbackQuery('❌ Errore caricamento analytics');
            }
            return;
        }

        if (data.startsWith('g_analytics_refresh:')) {
            try {
                const monthlyStats = require('../analytics/monthly-stats');
                const monthYear = data.split(':')[1];

                await ctx.answerCallbackQuery('🔄 Aggiornamento in corso...');

                // Force recalculate
                const stats = await monthlyStats.getMonthlyStats(db, monthYear, true);
                const prevMonth = monthlyStats.getPreviousMonth(monthYear);
                const prevStats = await monthlyStats.getMonthlyStats(db, prevMonth, false);

                await ui.sendMonthlyAnalytics(ctx, stats || {}, monthYear, prevStats);
            } catch (e) {
                logger.error(`[super-admin] Analytics refresh error: ${e.message}`);
                await ctx.answerCallbackQuery('❌ Errore aggiornamento');
            }
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
                    } catch (e) { }
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
