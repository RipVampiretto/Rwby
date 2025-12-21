const i18n = require('../../i18n');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const t = (key, params) => i18n.t(guildId, key, params);

    const config = await db.fetchGuildConfig(guildId);
    const staffGroup = config.staff_group_id ? `✅ Set (${config.staff_group_id})` : t('logger.channel_not_set');

    const text = `${t('staff.title')}\n\n` +
        `${t('staff.description')}\n\n` +
        `${t('staff.staff_group')}: ${staffGroup}\n\n` +
        `**${t('staff.commands_title')}:**\n` +
        `${t('staff.cmd_setstaff')}\n` +
        `${t('staff.cmd_notes')}\n` +
        `${t('staff.cmd_notes_add')}`;

    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: "settings_main" }
        : { text: t('common.close'), callback_data: "stf_close" };

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

function formatNoteList(guildId, targetId, notes) {
    const t = (key, params) => i18n.t(guildId, key, params);

    if (notes.length === 0) {
        return t('staff.notes.empty');
    }

    let text = `${t('staff.notes.title', { id: targetId })}\n\n`;
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
