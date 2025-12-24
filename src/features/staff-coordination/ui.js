const i18n = require('../../i18n');
const logger = require('../../middlewares/logger');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);

    const staffGroupSet = !!config.staff_group_id;
    const logChannelSet = !!config.log_channel_id;

    const onOff = enabled => (enabled ? t('common.on') : t('common.off'));
    const onOffLabel = enabled => (enabled ? 'ON' : 'OFF');

    // Build text
    let text = t('staff.title') + '\n\n';
    text += t('staff.description') + '\n\n';
    text += `${t('staff.staff_group')}: ${onOff(staffGroupSet)}`;
    if (staffGroupSet) {
        text += ` (<code>${config.staff_group_id}</code>)`;
    }
    text += '\n';
    text += `${t('logger.channel')}: ${onOff(logChannelSet)}`;
    if (logChannelSet) {
        text += ` (<code>${config.log_channel_id}</code>)`;
    }
    text += '\n';

    // Build keyboard dynamically
    const rows = [];

    // Row 1: Main toggles (Set/Remove buttons)
    rows.push([
        {
            text: t('staff.buttons.staff_group_toggle', { status: onOffLabel(staffGroupSet) }),
            callback_data: staffGroupSet ? 'stf_del:group' : 'stf_wizard:group'
        },
        {
            text: t('staff.buttons.channel_toggle', { status: onOffLabel(logChannelSet) }),
            callback_data: logChannelSet ? 'stf_del:channel' : 'stf_wizard:channel'
        }
    ]);

    // Staff Group settings (only if set)
    if (staffGroupSet) {
        rows.push([{ text: t('staff.buttons.change_staff_group'), callback_data: 'stf_wizard:group' }]);
    }

    // Log Channel settings (only if set)
    if (logChannelSet) {
        rows.push([{ text: t('staff.buttons.change_channel'), callback_data: 'stf_wizard:channel' }]);
    }

    // Back button
    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: 'settings_main' }
        : { text: t('common.close'), callback_data: 'stf_close' };
    rows.push([closeBtn]);

    const keyboard = { inline_keyboard: rows };

    if (isEdit) {
        try {
            await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
            logger.debug('[staff-coordination] UI message edited successfully');
        } catch (e) {
            logger.warn(`[staff-coordination] Failed to edit message: ${e.message}`);
        }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    }
}

async function sendWizardPrompt(ctx, type) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    let title, instruction;
    if (type === 'set_staff_group') {
        title = t('staff.wizard.set_group_title');
        instruction = t('staff.wizard.set_group_instruction');
    } else if (type === 'set_log_channel') {
        title = t('staff.wizard.set_channel_title');
        instruction = t('staff.wizard.set_channel_instruction');
    }

    const text = `<b>${title}</b>\n\n` + `${instruction}\n\n` + `${t('staff.wizard.cancel_tip')}`;

    const keyboard = {
        inline_keyboard: [[{ text: t('common.cancel'), callback_data: 'stf_cancel' }]]
    };

    try {
        await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    } catch (e) {
        logger.error(`[staff-coordination] Failed to send wizard prompt: ${e.message}`);
    }
}

async function formatNoteList(guildId, targetId, notes) {
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    if (notes.length === 0) {
        return t('staff.notes.empty');
    }

    let text = `${t('staff.notes.title', { id: targetId })}\n\n`;
    notes.forEach(note => {
        const icon = note.severity === 'critical' ? '🔴' : note.severity === 'warning' ? '🟠' : '🔵';
        text += `${icon} <b>[${note.severity.toUpperCase()}]</b> ${note.created_at.substring(0, 10)}\n`;
        text += `└ ${note.note_text}\n\n`;
    });
    return text;
}

module.exports = {
    sendConfigUI,
    sendWizardPrompt,
    formatNoteList
};
