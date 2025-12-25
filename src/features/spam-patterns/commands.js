const logic = require('./logic');
const actions = require('./actions');
const ui = require('./ui');
const manage = require('./manage');
const { isAdmin } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');

function registerCommands(bot, db) {
    // Middleware: check messages against modals
    bot.on('message:text', async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip admins
        if (await isAdmin(ctx, 'modal-patterns')) return next();

        // Config check
        const config = await db.getGuildConfig(ctx.chat.id);
        if (!config.spam_patterns_enabled) return next();

        // Check against modals
        const match = await logic.checkMessageAgainstModals(ctx, config);
        if (match) {
            await actions.executeAction(ctx, match.action, match.category, match.pattern, match.similarity);
        }

        await next();
    });

    // UI Handlers
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith('mdl_')) return next();

        const config = await db.getGuildConfig(ctx.chat.id);

        if (data === 'mdl_toggle') {
            await db.updateGuildConfig(ctx.chat.id, { spam_patterns_enabled: config.spam_patterns_enabled ? 0 : 1 });
            await ui.sendConfigUI(ctx, db, true);
        } else if (data === 'mdl_act') {
            // Only two actions: report_only and delete
            const acts = ['report_only', 'delete'];
            let cur = config.spam_patterns_action || 'report_only';
            if (!acts.includes(cur)) cur = 'report_only';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 2];
            await db.updateGuildConfig(ctx.chat.id, { spam_patterns_action: nextAct });
            await ui.sendConfigUI(ctx, db, true);
        } else if (data === 'mdl_notify') {
            // Toggle local notifications for current action
            let logEvents = {};
            if (config.log_events) {
                if (typeof config.log_events === 'string') {
                    try {
                        logEvents = JSON.parse(config.log_events);
                    } catch (e) { }
                } else if (typeof config.log_events === 'object') {
                    logEvents = config.log_events;
                }
            }

            // Toggle the appropriate event based on current action
            const currentAction = config.spam_patterns_action || 'report_only';
            const logEventKey = currentAction === 'delete' ? 'modal_delete' : 'modal_report';
            logEvents[logEventKey] = !logEvents[logEventKey];

            await db.updateGuildConfig(ctx.chat.id, { log_events: JSON.stringify(logEvents) });
            await ui.sendConfigUI(ctx, db, true);
        } else if (data === 'mdl_list') {
            await ui.sendModalListUI(ctx, db, true);
        } else if (data === 'mdl_back') {
            await ui.sendConfigUI(ctx, db, true);
        } else if (data.startsWith('mdl_cat:')) {
            const category = data.split(':')[1];
            await manage.toggleGuildCategory(ctx.chat.id, category);
            await ui.sendModalListUI(ctx, db, true);
        }
    });

    logger.info('[spam-patterns] Module registered');
}

module.exports = {
    registerCommands
};
