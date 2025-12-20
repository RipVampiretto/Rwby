async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
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

function formatNoteList(targetId, notes) {
    if (notes.length === 0) {
        return `ℹ️ Nessuna nota trovata per utente \`${targetId}\`.`;
    }

    let text = `📝 <b>Note per utente ${targetId}:</b>\n\n`;
    notes.forEach(note => {
        const icon = note.severity === 'critical' ? '🔴' : (note.severity === 'warning' ? '🟠' : '🔵');
        text += `${icon} <b>[${note.severity.toUpperCase()}]</b> ${note.created_at.substring(0, 10)}\n`;
        text += `└ ${note.note_text}\n\n`;
    });
    return text;
}

module.exports = {
    sendConfigUI,
    formatNoteList
};
