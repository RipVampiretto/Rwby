const logger = require('../../middlewares/logger');
const { safeDelete, safeBan } = require('../../utils/error-handlers');
const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');

let db = null;
let _botInstance = null;

function init(database, bot) {
    db = database;
    _botInstance = bot;
}

async function executeAction(ctx, action, trigger) {
    const user = ctx.from;
    logger.info(`[anti-spam] Trigger: ${trigger} Action: ${action} User: ${user.id}`);

    // Log Logic using adminLogger if available
    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'spam',
        targetUser: user,
        executorAdmin: null,
        reason: trigger,
        isGlobal: false
    };

    if (action === 'delete') {
        await safeDelete(ctx, 'anti-spam');
        if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
    }
    else if (action === 'ban') {
        await safeDelete(ctx, 'anti-spam');
        const banned = await safeBan(ctx, user.id, 'anti-spam');

        if (banned) {
            await ctx.reply(`🚫 **BANNED**\nHas been banned for spam.`);
            userReputation.modifyFlux(user.id, ctx.chat.id, -100, 'spam_ban');
            await forwardBanToSuperAdmin(ctx, user, trigger);

            logParams.eventType = 'ban';
            logParams.isGlobal = true;
            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
        }
    }
    else if (action === 'report_only') {
        // Send to Staff Queue
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Anti-Spam',
            user: user,
            reason: `Trigger: ${trigger}`,
            messageId: ctx.message.message_id,
            content: ctx.message.text
        });
    }
}

async function forwardBanToSuperAdmin(ctx, user, trigger) {
    try {
        const globalConfig = db.getDb().prepare('SELECT * FROM global_config WHERE id = 1').get();
        if (!globalConfig || !globalConfig.parliament_group_id) return;

        const flux = userReputation.getLocalFlux(user.id, ctx.chat.id);

        const text = `🔨 **BAN ESEGUITO**\n\n` +
            `🏛️ Gruppo: ${ctx.chat.title} (@${ctx.chat.username || 'private'})\n` +
            `👤 Utente: ${user.first_name} (@${user.username}) (ID: \`${user.id}\`)\n` +
            `📊 Flux: ${flux}\n` +
            `⏰ Ora: ${new Date().toISOString()}\n\n` +
            `📝 Motivo: ${trigger}\n` +
            `🔧 Trigger: anti-spam\n\n` +
            `💬 Content:\n"${ctx.message.text ? ctx.message.text.substring(0, 200) : 'N/A'}"`;

        const keyboard = {
            inline_keyboard: [
                [{ text: "🌍 Global Ban", callback_data: `gban:${user.id}` }, { text: "✅ Solo Locale", callback_data: `gban_skip:${ctx.message.message_id}` }]
            ]
        };

        if (_botInstance) {
            await _botInstance.api.sendMessage(globalConfig.parliament_group_id, text, {
                reply_markup: keyboard,
                parse_mode: 'Markdown'
            });
        }
    } catch (e) {
        logger.error(`[anti-spam] Failed to forward ban: ${e.message}`);
    }
}

module.exports = {
    init,
    executeAction
};
