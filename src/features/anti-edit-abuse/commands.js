const snapshots = require('./snapshots');
const core = require('./core');
const ui = require('./ui');
const { isAdmin } = require('../../utils/error-handlers');

function registerCommands(bot, db) {
    // Store snapshot on new message
    bot.on('message:text', async (ctx, next) => {
        if (ctx.chat.type !== 'private') {
            snapshots.saveSnapshot(ctx.message);
        }
        await next();
    });

    // Handler: edited messages
    bot.on('edited_message', async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip admins
        if (await isAdmin(ctx, 'anti-edit-abuse')) return next();

        // Config check
        const config = await db.getGuildConfig(ctx.chat.id);
        if (!config.edit_monitor_enabled) return next();

        await core.processEdit(ctx, config);
        await next();
    });

    // UI Handlers
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith('edt_')) return next();

        const config = await db.getGuildConfig(ctx.chat.id);

        if (data === 'edt_toggle') {
            await db.updateGuildConfig(ctx.chat.id, { edit_monitor_enabled: config.edit_monitor_enabled ? 0 : 1 });
        } else if (data === 'edt_act') {
            // Only two actions: delete and report_only
            const acts = ['delete', 'report_only'];
            let cur = config.edit_action || 'delete';
            if (!acts.includes(cur)) cur = 'delete';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 2];
            await db.updateGuildConfig(ctx.chat.id, { edit_action: nextAct });
        } else if (data === 'edt_grace') {
            // Cycle through grace periods: 0, 1, 3, 5, 10 minutes
            const current = config.edit_grace_period ?? 0;
            const periods = [0, 1, 3, 5, 10];
            const idx = periods.indexOf(current);
            const next = periods[(idx + 1) % periods.length];
            await db.updateGuildConfig(ctx.chat.id, { edit_grace_period: next });
        } else if (data.startsWith('edt_log_')) {
            // Log toggle
            const logType = data.replace('edt_log_', '');
            const logKey = `edit_${logType}`;

            let logEvents = {};
            if (config.log_events) {
                if (typeof config.log_events === 'string') {
                    try { logEvents = JSON.parse(config.log_events); } catch (e) { }
                } else if (typeof config.log_events === 'object') {
                    logEvents = config.log_events;
                }
            }
            logEvents[logKey] = !logEvents[logKey];
            await db.updateGuildConfig(ctx.chat.id, { log_events: logEvents });
        }

        await ui.sendConfigUI(ctx, db, true);
    });
}

module.exports = {
    registerCommands
};
