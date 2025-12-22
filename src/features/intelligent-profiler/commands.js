const logic = require('./logic');
const actions = require('./actions');
const ui = require('./ui');
const { isAdmin, isFromSettingsMenu } = require('../../utils/error-handlers');

function registerCommands(bot, db) {
    // Middleware: profile Tier 0 users
    bot.on('message', async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip check for admins
        if (await isAdmin(ctx, 'intelligent-profiler')) return next();

        // Config check
        const config = db.getGuildConfig(ctx.chat.id);
        if (!config.profiler_enabled) return next();

        // Require Tier 0 (Novice)
        if (ctx.userTier === undefined || ctx.userTier >= 1) return next();

        const violation = await logic.scanMessage(ctx, config);

        if (violation) {
            await actions.executeAction(ctx, violation.action, violation.reason, violation.content);
            return; // Stop processing
        }

        await next();
    });

    // UI Handlers
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith('prf_')) return next();

        const config = db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === 'prf_close') return ctx.deleteMessage();

        if (data === 'prf_toggle') {
            await db.updateGuildConfig(ctx.chat.id, { profiler_enabled: config.profiler_enabled ? 0 : 1 });
        } else if (data === 'prf_act_link') {
            const acts = ['delete', 'ban', 'report_only'];
            let cur = config.profiler_action_link || 'delete';
            if (!acts.includes(cur)) cur = 'delete';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 3];
            await db.updateGuildConfig(ctx.chat.id, { profiler_action_link: nextAct });
        } else if (data === 'prf_act_fwd') {
            const acts = ['delete', 'ban', 'report_only'];
            let cur = config.profiler_action_forward || 'delete';
            if (!acts.includes(cur)) cur = 'delete';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 3];
            await db.updateGuildConfig(ctx.chat.id, { profiler_action_forward: nextAct });
        } else if (data === 'prf_act_pat') {
            const acts = ['delete', 'ban', 'report_only'];
            let cur = config.profiler_action_pattern || 'report_only';
            if (!acts.includes(cur)) cur = 'report_only';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 3];
            await db.updateGuildConfig(ctx.chat.id, { profiler_action_pattern: nextAct });
        }

        await ui.sendConfigUI(ctx, db, true, fromSettings);
    });
}

module.exports = {
    registerCommands
};
