const logic = require('./logic');
const ui = require('./ui');
const { isAdmin } = require('../../utils/error-handlers');

// Simple wizard session storage for log channel configuration
const LOG_CHANNEL_WIZARDS = new Map();

function registerCommands(bot, db) {
    // Command: /setstaff <id>
    bot.command('setstaff', async ctx => {
        if (ctx.chat.type === 'private') {
            return ctx.reply('⚠️ Questo comando deve essere usato in un gruppo.');
        }

        if (!(await isAdmin(ctx, 'staff-coordination'))) {
            return ctx.reply('⚠️ Non hai i permessi necessari.');
        }

        const args = ctx.message.text.split(' ').slice(1);

        if (!args[0]) {
            return ctx.reply("❌ Specifica l'ID del gruppo staff.\nUso: `/setstaff -100123456789`", {
                parse_mode: 'HTML'
            });
        }

        const staffId = parseInt(args[0]);
        if (isNaN(staffId)) {
            return ctx.reply('❌ ID non valido. Usa: /setstaff -100123456789');
        }

        try {
            await logic.setStaffGroup(db, ctx, bot, staffId);
            await ctx.reply(`✅ Staff Group impostato: \`${staffId}\``, { parse_mode: 'HTML' });
        } catch (e) {
            await ctx.reply(
                `❌ Impossibile inviare messaggi nel gruppo \`${staffId}\`.\nAssicurati che il bot sia admin con permessi di scrittura.`,
                { parse_mode: 'HTML' }
            );
        }
    });

    // Command: /notes
    bot.command('notes', async ctx => {
        if (ctx.chat.type === 'private') return;

        const config = await db.getGuildConfig(ctx.chat.id);
        const staffGroupId = config.staff_group_id || ctx.chat.id;
        const args = ctx.message.text.split(' ').slice(1);

        // /notes add <id> <text>
        if (args[0] === 'add') {
            if (args.length < 3) {
                return ctx.reply('❌ Uso: `/notes add <user_id> <testo>`', { parse_mode: 'HTML' });
            }

            const targetId = parseInt(args[1]);
            if (isNaN(targetId)) {
                return ctx.reply('❌ ID utente non valido.');
            }

            const noteText = args.slice(2).join(' ');
            await logic.addNote(db, ctx, targetId, noteText, staffGroupId);
            await ctx.reply(`✅ Nota aggiunta per utente \`${targetId}\``, { parse_mode: 'HTML' });
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
                '❌ Uso:\n`/notes <user_id>` - Visualizza note\n`/notes add <user_id> <severity> <testo>` - Aggiungi nota',
                { parse_mode: 'HTML' }
            );
        }

        const notes = await logic.getNotes(db, targetId, staffGroupId);
        const text = await ui.formatNoteList(ctx.chat.id, targetId, notes);
        await ctx.reply(text, { parse_mode: 'HTML' });
    });

    // Log channel wizard handler (must come BEFORE callback handler to catch text input)
    bot.on('message:text', async (ctx, next) => {
        const sessionKey = `${ctx.from.id}:${ctx.chat.id}`;
        if (!LOG_CHANNEL_WIZARDS.has(sessionKey)) return next();

        const text = ctx.message.text.trim();

        // Handle cancel
        if (text.toLowerCase() === 'cancel') {
            LOG_CHANNEL_WIZARDS.delete(sessionKey);
            await ctx.reply('❌ Operazione annullata.');
            return;
        }

        // Try to parse as channel ID
        let channelId;
        if (text.match(/^-?\d+$/)) {
            channelId = parseInt(text);
        }

        if (!channelId || isNaN(channelId)) {
            await ctx.reply('❌ ID non valido. Usa un ID numerico (es. `-100123456789`). Scrivi "cancel" per annullare.', { parse_mode: 'HTML' });
            return;
        }

        // Try to send a test message
        try {
            await ctx.api.sendMessage(channelId, '✅ Canale Log configurato correttamente!');
            await db.updateGuildConfig(ctx.chat.id, { log_channel_id: channelId });
            await ctx.reply(`✅ Canale Log impostato: \`${channelId}\``, { parse_mode: 'HTML' });
        } catch (e) {
            await ctx.reply(
                `❌ Impossibile inviare messaggi nel canale \`${channelId}\`.\nAssicurati che il bot sia admin con permessi di scrittura.`,
                { parse_mode: 'HTML' }
            );
        }

        LOG_CHANNEL_WIZARDS.delete(sessionKey);
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
                '📢 **Imposta Canale Log**\n\nInvia l\'ID del canale dove inviare i log (es. `-100123456789`).\n\nScrivi "cancel" per annullare.',
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
