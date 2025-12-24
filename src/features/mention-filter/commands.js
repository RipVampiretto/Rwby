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
            const lang = await i18n.getLanguage(targetChatId);
            const t = (key, params) => i18n.t(lang, key, params);

            try {
                await ctx.api.deleteMessage(targetChatId, targetMsgId);
                const originalHtml = getHtmlText(ctx.callbackQuery.message);
                await ctx.editMessageText(
                    originalHtml + `\n\n${t('mention.staff_alert.deleted_by', { name: ctx.from.first_name })}`,
                    { parse_mode: 'HTML' }
                );
                await ctx.answerCallbackQuery('✅');
            } catch (e) {
                await ctx.answerCallbackQuery('❌');
            }
            return;
        }

        if (data.startsWith('mnt_staff_ignore')) {
            const parts = data.split(':');
            const targetChatId = parts.length > 1 ? parseInt(parts[1]) : ctx.chat.id;

            const i18n = require('../../i18n');
            const lang = await i18n.getLanguage(targetChatId);
            const t = (key, params) => i18n.t(lang, key, params);

            const originalHtml = getHtmlText(ctx.callbackQuery.message);
            await ctx.editMessageText(
                originalHtml + `\n\n${t('mention.staff_alert.ignored_by', { name: ctx.from.first_name })}`,
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
            const newState = !config.mention_filter_notify;

            // Sync with action-log config
            let logEvents = {};
            try {
                if (typeof config.log_events === 'string') {
                    logEvents = JSON.parse(config.log_events);
                } else if (typeof config.log_events === 'object') {
                    logEvents = config.log_events || {};
                }
            } catch (e) { }

            if (Array.isArray(logEvents)) logEvents = {};

            logEvents['mention_delete'] = newState;
            logEvents['mention_scam'] = newState;

            await db.updateGuildConfig(ctx.chat.id, {
                mention_filter_notify: newState,
                log_events: JSON.stringify(logEvents)
            });
        }

        await ui.sendConfigUI(ctx, db, true, fromSettings);
    });

    logger.info('[mention-filter] Commands registered');
}

function getHtmlText(message) {
    const text = message.text || message.caption || '';
    const entities = message.entities || message.caption_entities || [];

    if (!entities.length) return text;

    const escape = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const points = new Set([0, text.length]);
    entities.forEach(e => {
        points.add(e.offset);
        points.add(e.offset + e.length);
    });

    const sortedPoints = Array.from(points).sort((a, b) => a - b);
    let result = '';

    for (let i = 0; i < sortedPoints.length - 1; i++) {
        const start = sortedPoints[i];
        const end = sortedPoints[i + 1];
        const segmentText = escape(text.slice(start, end));

        const activeEntities = entities.filter(e => e.offset <= start && (e.offset + e.length) >= end);
        activeEntities.sort((a, b) => a.length - b.length);

        let wrapped = segmentText;
        for (const entity of activeEntities) {
            switch (entity.type) {
                case 'bold': wrapped = `<b>${wrapped}</b>`; break;
                case 'italic': wrapped = `<i>${wrapped}</i>`; break;
                case 'code': wrapped = `<code>${wrapped}</code>`; break;
                case 'pre': wrapped = `<pre>${wrapped}</pre>`; break;
                case 'strikethrough': wrapped = `<s>${wrapped}</s>`; break;
                case 'underline': wrapped = `<u>${wrapped}</u>`; break;
                case 'spoiler': wrapped = `<tg-spoiler>${wrapped}</tg-spoiler>`; break;
                case 'text_link': wrapped = `<a href="${escape(entity.url)}">${wrapped}</a>`; break;
                case 'text_mention': wrapped = `<a href="tg://user?id=${entity.user.id}">${wrapped}</a>`; break;
            }
        }
        result += wrapped;
    }
    return result;
}

module.exports = {
    registerCommands
};
