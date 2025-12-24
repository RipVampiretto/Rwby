const logger = require('../../middlewares/logger');
const { safeDelete, safeBan } = require('../../utils/error-handlers');
const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const i18n = require('../../i18n');

let db = null;
let _botInstance = null;

function init(database, bot) {
    db = database;
    _botInstance = bot;
}

async function executeAction(ctx, action, trigger) {
    const user = ctx.from;
    logger.info(`[anti-spam] Trigger: ${trigger} Action: ${action} User: ${user.id}`);

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
    } else if (action === 'ban') {
        await safeDelete(ctx, 'anti-spam');
        const banned = await safeBan(ctx, user.id, 'anti-spam');

        if (banned) {
            await ctx.reply(`🚫 **BANNED**\nHas been banned for spam.`);
            await userReputation.modifyFlux(db, user.id, ctx.chat.id, -100, 'spam_ban');
            await forwardBanToSuperAdmin(ctx, user, trigger);

            logParams.eventType = 'ban';
            logParams.isGlobal = true;
            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
        }
    } else if (action === 'report_only') {
        await staffCoordination.reviewQueue(_botInstance, db, {
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
        const globalConfig = await db.queryOne('SELECT * FROM global_config WHERE id = 1');
        if (!globalConfig || !globalConfig.parliament_group_id) return;

        const flux = await userReputation.getLocalFlux(db, user.id, ctx.chat.id);
        const lang = await i18n.getLanguage(globalConfig.parliament_group_id);
        const t = key => i18n.t(lang, key);

        const text =
            `${t('common.logs.ban_executed_title')}\n\n` +
            `${t('common.logs.group')}: ${ctx.chat.title} (@${ctx.chat.username || 'private'})\n` +
            `${t('common.logs.user')}: <a href="tg://user?id=${user.id}">${user.first_name}</a> (@${user.username}) [<code>${user.id}</code>]\n` +
            `${t('common.logs.flux')}: ${flux}\n` +
            `⏰ Time: ${new Date().toISOString()}\n\n` +
            `${t('common.logs.reason')}: ${trigger}\n` +
            `🔧 Trigger: anti-spam\n\n` +
            `${t('common.logs.evidence')}:\n"${ctx.message.text ? ctx.message.text.substring(0, 200) : 'N/A'}"`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: t('common.logs.global_ban'), callback_data: `gban:${user.id}` },
                    { text: t('common.logs.local_only'), callback_data: `gban_skip:${ctx.message.message_id}` }
                ]
            ]
        };

        if (_botInstance) {
            await _botInstance.api.sendMessage(globalConfig.parliament_group_id, text, {
                reply_markup: keyboard,
                parse_mode: 'HTML'
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
