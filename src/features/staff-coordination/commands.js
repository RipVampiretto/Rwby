const logic = require('./logic');
const ui = require('./ui');
const { isAdmin } = require('../../utils/error-handlers');

function registerCommands(bot, db) {
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

        try {
            await logic.setStaffGroup(db, ctx, bot, staffId);
            await ctx.reply(`✅ Staff Group impostato: \`${staffId}\``, { parse_mode: 'Markdown' });
        } catch (e) {
            await ctx.reply(`❌ Impossibile inviare messaggi nel gruppo \`${staffId}\`.\nAssicurati che il bot sia admin con permessi di scrittura.`, { parse_mode: 'Markdown' });
        }
    });

    // Command: /notes
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
            await logic.addNote(db, ctx, targetId, noteText, staffGroupId);
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

        const notes = await logic.getNotes(db, targetId, staffGroupId);
        const text = ui.formatNoteList(targetId, notes);
        await ctx.reply(text, { parse_mode: 'HTML' });
    });

    // Action Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;

        if (data.startsWith("staff_ban:")) {
            await logic.handleStaffAction(ctx, bot, 'ban', data);
        }
        else if (data === ("staff_ign")) {
            await logic.handleStaffAction(ctx, bot, 'dismiss', data);
        }
        else if (data.startsWith("staff_del:")) {
            await logic.handleStaffAction(ctx, bot, 'delete', data);
        }
        else if (data === "stf_close") {
            await ctx.deleteMessage();
        }
        else {
            return next();
        }
    });
}

module.exports = {
    registerCommands
};
