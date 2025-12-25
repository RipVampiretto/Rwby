const logic = require('./logic');
const ui = require('./ui');

// Simple wizard session storage for channel/group configuration
const LOG_CHANNEL_WIZARDS = new Map();
const STAFF_GROUP_WIZARDS = new Map();

function registerCommands(bot, db) {
    // Command: /notes
    bot.command('notes', async ctx => {
        if (ctx.chat.type === 'private') return;

        const config = await db.getGuildConfig(ctx.chat.id);
        const staffGroupId = config.staff_group_id || ctx.chat.id;
        const args = ctx.message.text.split(' ').slice(1);

        // /notes add <id> <text>
        if (args[0] === 'add') {
            if (args.length < 3) {
                return ctx.reply('❌ Uso: <code>/notes add &lt;user_id&gt; &lt;testo&gt;</code>', {
                    parse_mode: 'HTML'
                });
            }

            const targetId = parseInt(args[1]);
            if (isNaN(targetId)) {
                return ctx.reply('❌ ID utente non valido.');
            }

            const noteText = args.slice(2).join(' ');
            await logic.addNote(db, ctx, targetId, noteText, staffGroupId);
            await ctx.reply(`✅ Nota aggiunta per utente <code>${targetId}</code>`, { parse_mode: 'HTML' });
            return;
        }

        // /notes <id> - View notes
        let targetId = parseInt(args[0]);

        // Also support reply-to-message
        if (!targetId && ctx.message.reply_to_message?.from) {
            targetId = ctx.message.reply_to_message.from.id;
        }

        if (!targetId) {
            return ctx.reply(
                '❌ Uso:\n<code>/notes &lt;user_id&gt;</code> - Visualizza note\n<code>/notes add &lt;user_id&gt; &lt;severity&gt; &lt;testo&gt;</code> - Aggiungi nota',
                { parse_mode: 'HTML' }
            );
        }

        const notes = await logic.getNotes(db, targetId, staffGroupId);
        const text = await ui.formatNoteList(ctx.chat.id, targetId, notes);
        await ctx.reply(text, { parse_mode: 'HTML' });
    });

    // Wizard handlers for both log channel and staff group (must come BEFORE callback handler)
    bot.on('message:text', async (ctx, next) => {
        const sessionKey = `${ctx.from.id}:${ctx.chat.id}`;
        const isLogWizard = LOG_CHANNEL_WIZARDS.has(sessionKey);
        const isStaffWizard = STAFF_GROUP_WIZARDS.has(sessionKey);

        if (!isLogWizard && !isStaffWizard) return next();

        const text = ctx.message.text.trim();

        // Handle cancel for both
        if (text.toLowerCase() === 'cancel') {
            LOG_CHANNEL_WIZARDS.delete(sessionKey);
            STAFF_GROUP_WIZARDS.delete(sessionKey);
            await ctx.reply('❌ Operazione annullata.');
            return;
        }

        // Try to parse as ID
        let targetId;
        if (text.match(/^-?\d+$/)) {
            targetId = parseInt(text);
        }

        if (!targetId || isNaN(targetId)) {
            await ctx.reply(
                '❌ ID non valido. Usa un ID numerico (es. `-100123456789`). Scrivi "cancel" per annullare.',
                { parse_mode: 'HTML' }
            );
            return;
        }

        // Try to send a test message
        try {
            if (isLogWizard) {
                await ctx.api.sendMessage(targetId, '✅ Canale Log configurato correttamente!');
                await db.updateGuildConfig(ctx.chat.id, { log_channel_id: targetId });
                await ctx.reply(`✅ Canale Log impostato: <code>${targetId}</code>`, { parse_mode: 'HTML' });
                LOG_CHANNEL_WIZARDS.delete(sessionKey);
            } else if (isStaffWizard) {
                await ctx.api.sendMessage(targetId, '✅ Staff Group configurato correttamente!');
                await db.updateGuildConfig(ctx.chat.id, { staff_group_id: targetId });
                await ctx.reply(`✅ Staff Group impostato: <code>${targetId}</code>`, { parse_mode: 'HTML' });
                STAFF_GROUP_WIZARDS.delete(sessionKey);
            }
        } catch (e) {
            const label = isLogWizard ? 'canale' : 'gruppo';
            await ctx.reply(
                `❌ Impossibile inviare messaggi nel ${label} <code>${targetId}</code>.\nAssicurati che il bot sia admin con permessi di scrittura.`,
                { parse_mode: 'HTML' }
            );
        }
    });

    // Action Handlers
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;

        if (data.startsWith('staff_ban:')) {
            await logic.handleStaffAction(ctx, bot, 'ban', data);
        } else if (data === 'staff_ign') {
            await logic.handleStaffAction(ctx, bot, 'dismiss', data);
        } else if (data.startsWith('staff_del:')) {
            await logic.handleStaffAction(ctx, bot, 'delete', data);
        } else if (data === 'stf_close') {
            await ctx.deleteMessage();
        } else if (data === 'stf_set_log_channel') {
            // Start wizard to set log channel
            const sessionKey = `${ctx.from.id}:${ctx.chat.id}`;
            LOG_CHANNEL_WIZARDS.set(sessionKey, { startedAt: Date.now() });

            await ctx.reply(
                '📢 <b>Imposta Canale Log</b>\n\nInvia l\'ID del canale dove inviare i log (es. <code>-100123456789</code>).\n\nScrivi "cancel" per annullare.',
                { parse_mode: 'HTML' }
            );
            await ctx.answerCallbackQuery();
            return;
        } else if (data === 'stf_set_staff_group') {
            // Start wizard to set staff group
            const sessionKey = `${ctx.from.id}:${ctx.chat.id}`;
            STAFF_GROUP_WIZARDS.set(sessionKey, { startedAt: Date.now() });

            await ctx.reply(
                '👥 <b>Imposta Staff Group</b>\n\nInvia l\'ID del gruppo staff dove inviare le segnalazioni (es. <code>-100123456789</code>).\n\nScrivi "cancel" per annullare.',
                { parse_mode: 'HTML' }
            );
            await ctx.answerCallbackQuery();
            return;
        } else {
            return next();
        }
    });
}

module.exports = {
    registerCommands
};
