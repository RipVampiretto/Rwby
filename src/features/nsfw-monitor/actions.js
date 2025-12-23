const adminLogger = require('../admin-logger');
const superAdmin = require('../super-admin');
const staffCoordination = require('../staff-coordination');
const i18n = require('../../i18n');
const { safeDelete } = require('../../utils/error-handlers');

async function executeAction(ctx, action, reason, type) {
    const user = ctx.from;

    // Parse log events from config
    const db = require('../../database');
    const config = await db.getGuildConfig(ctx.chat.id);
    let logEvents = {};
    if (config.log_events) {
        if (typeof config.log_events === 'string') {
            try { logEvents = JSON.parse(config.log_events); } catch (e) { }
        } else if (typeof config.log_events === 'object') {
            logEvents = config.log_events;
        }
    }

    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'media_delete',
        targetUser: user,
        reason: `Media (${type}): ${reason}`,
        isGlobal: false
    };

    if (action === 'delete') {
        // Forward original media to Parliament BEFORE deleting (with gban option)
        if (superAdmin.forwardMediaToParliament) {
            const caption = `🖼️ **CONTENUTO NON CONFORME**\n\n` +
                `🏛️ Gruppo: ${ctx.chat.title}\n` +
                `👤 Utente: [${user.first_name}](tg://user?id=${user.id}) [\`${user.id}\`]\n` +
                `📝 Categoria: ${reason}\n` +
                `📁 Tipo: ${type}`;

            await superAdmin.forwardMediaToParliament('reports', ctx, caption, [
                [
                    { text: '🌍 Global Ban Utente', callback_data: `gban:${user.id}` },
                    { text: '✅ Ignora', callback_data: 'parl_dismiss' }
                ]
            ]);
        }

        // Delete message
        await safeDelete(ctx, 'media-monitor');

        // Send warning to user (auto-delete after 1 minute)
        try {
            const lang = await i18n.getLanguage(ctx.chat.id);
            const userName = user.username ? `@${user.username}` : `<a href="tg://user?id=${user.id}">${user.first_name}</a>`;
            const warningMsg = i18n.t(lang, 'media.warning', { user: userName });

            const warning = await ctx.reply(warningMsg, { parse_mode: 'HTML' });
            setTimeout(async () => {
                try {
                    await ctx.api.deleteMessage(ctx.chat.id, warning.message_id);
                } catch (e) { }
            }, 60000);
        } catch (e) { }

        // Log only if enabled
        if (logEvents['media_delete'] && adminLogger.getLogEvent()) {
            adminLogger.getLogEvent()(logParams);
        }

    } else if (action === 'report_only') {
        // Forward to staff group for review
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Media-AI',
            user: user,
            reason: reason,
            messageId: ctx.message.message_id,
            content: `[Media ${type}]`
        });
    }
}

module.exports = {
    executeAction
};
