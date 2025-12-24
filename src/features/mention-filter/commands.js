const logic = require('./logic');
const actions = require('./actions');
const ui = require('./ui');
const { isAdmin, isFromSettingsMenu } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');

function registerCommands(bot, db) {
    // Middleware: mention detection on all text messages
    bot.on('message:text', async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip admins
        if (await isAdmin(ctx, 'mention-filter')) return next();

        // Config check
        const config = await db.getGuildConfig(ctx.chat.id);
        if (!config.mention_filter_enabled) return next();

        // Scan for suspicious external mentions
        const verdict = await logic.scanMessage(ctx, config);
        if (verdict) {
            await actions.executeAction(ctx, config, verdict);
            // If action is delete, don't continue processing
            if (config.mention_filter_action === 'delete' || verdict.type === 'gbanned') {
                return;
            }
        }

        await next();
    });

    // Also check captions on media messages
    bot.on('message:caption', async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip admins
        if (await isAdmin(ctx, 'mention-filter')) return next();

        // Config check
        const config = await db.getGuildConfig(ctx.chat.id);
        if (!config.mention_filter_enabled) return next();

        // Scan for suspicious external mentions
        const verdict = await logic.scanMessage(ctx, config);
        if (verdict) {
            await actions.executeAction(ctx, config, verdict);
            if (config.mention_filter_action === 'delete' || verdict.type === 'gbanned') {
                return;
            }
        }

        await next();
    });

    // UI Handlers
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith('mnt_')) return next();

        if (data === 'mnt_close') return ctx.deleteMessage();

        // Staff group action handlers (can be called from any chat where staff receives alerts)
        if (data.startsWith('mnt_staff_del:')) {
            const parts = data.split(':');
            const targetChatId = parseInt(parts[1]);
            const targetMsgId = parseInt(parts[2]);

            const i18n = require('../../i18n');
            const lang = await i18n.getLanguage(ctx.chat.id);
            const t = (key, params) => i18n.t(lang, key, params);

            try {
                await ctx.api.deleteMessage(targetChatId, targetMsgId);
                await ctx.editMessageText(
                    ctx.callbackQuery.message.text + `\n\n${t('mention.staff_alert.deleted_by', { name: ctx.from.first_name })}`,
                    { parse_mode: 'HTML' }
                );
                await ctx.answerCallbackQuery('✅');
            } catch (e) {
                await ctx.answerCallbackQuery('❌');
            }
            return;
        }

        if (data === 'mnt_staff_ignore') {
            const i18n = require('../../i18n');
            const lang = await i18n.getLanguage(ctx.chat.id);
            const t = (key, params) => i18n.t(lang, key, params);

            await ctx.editMessageText(
                ctx.callbackQuery.message.text + `\n\n${t('mention.staff_alert.ignored_by', { name: ctx.from.first_name })}`,
                { parse_mode: 'HTML' }
            );
            await ctx.answerCallbackQuery('✅');
            return;
        }

        // Config handlers - need to get config from the correct chat
        const config = await db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === 'mnt_toggle') {
            await db.updateGuildConfig(ctx.chat.id, {
                mention_filter_enabled: !config.mention_filter_enabled
            });
        } else if (data === 'mnt_action') {
            // Cycle through actions: report_only -> delete -> report_only
            const newAction = config.mention_filter_action === 'delete' ? 'report_only' : 'delete';
            await db.updateGuildConfig(ctx.chat.id, { mention_filter_action: newAction });
        } else if (data === 'mnt_notify') {
            await db.updateGuildConfig(ctx.chat.id, {
                mention_filter_notify: !config.mention_filter_notify
            });
        }

        await ui.sendConfigUI(ctx, db, true, fromSettings);
    });

    logger.info('[mention-filter] Commands registered');
}

module.exports = {
    registerCommands
};
