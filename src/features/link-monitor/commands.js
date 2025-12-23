const logic = require('./logic');
const actions = require('./actions');
const ui = require('./ui');
const { isAdmin, isFromSettingsMenu } = require('../../utils/error-handlers');

function registerCommands(bot, db) {
    // Middleware: link detection
    bot.on('message:text', async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip admins
        if (await isAdmin(ctx, 'link-monitor')) return next();

        // Config check
        const config = await db.getGuildConfig(ctx.chat.id);
        if (!config.link_enabled) return next();

        // Tier bypass check
        const tierBypass = config.link_tier_bypass ?? 2;
        if (tierBypass !== -1 && ctx.userTier !== undefined && ctx.userTier >= tierBypass) return next();

        const verdict = await logic.scanMessage(ctx, config);
        if (verdict) {
            await actions.executeAction(ctx, verdict);
            // If blacklist, process stops (message deleted). If unknown, it continues?
            // Logic in original code: "Only report first unknown link per message" and "next()" was called at the end.
            // Blacklist deletes message so we should probably stop next() if deleted.
            // But existing code called next() after processLinks.
            // Actually, processLinks had a return on blacklist `safeDelete`, but `executeAction` is async.
            // If we delete, we should probably stop.
            if (verdict.type === 'blacklist') return;
        }

        await next();
    });

    // UI Handlers
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith('lnk_')) return next();

        const config = await db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === 'lnk_close') return ctx.deleteMessage();

        if (data === 'lnk_toggle') {
            await db.updateGuildConfig(ctx.chat.id, { link_enabled: config.link_enabled ? 0 : 1 });
        } else if (data === 'lnk_sync') {
            await db.updateGuildConfig(ctx.chat.id, { link_sync_global: config.link_sync_global ? 0 : 1 });
        } else if (data === 'lnk_tier') {
            const current = config.link_tier_bypass ?? 2;
            const tiers = [0, 1, 2, 3, -1];
            const idx = tiers.indexOf(current);
            const next = tiers[(idx + 1) % tiers.length];
            await db.updateGuildConfig(ctx.chat.id, { link_tier_bypass: next });
        } else if (data === 'lnk_log_delete') {
            // Log toggle for link_delete
            let logEvents = {};
            if (config.log_events) {
                if (typeof config.log_events === 'string') {
                    try { logEvents = JSON.parse(config.log_events); } catch (e) { }
                } else if (typeof config.log_events === 'object') {
                    logEvents = config.log_events;
                }
            }
            logEvents['link_delete'] = !logEvents['link_delete'];
            await db.updateGuildConfig(ctx.chat.id, { log_events: logEvents });
        }

        await ui.sendConfigUI(ctx, db, true, fromSettings);
    });
}

module.exports = {
    registerCommands
};
