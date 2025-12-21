const logic = require('./logic');
const ui = require('./ui');

function registerCommands(bot, db) {
    // Middleware: attach user tier to context AND update active flux
    bot.use(async (ctx, next) => {
        if (ctx.from && ctx.chat && ctx.chat.type !== 'private') {
            const userId = ctx.from.id;
            const guildId = ctx.chat.id;

            // Calc & Attach Tier (async now)
            ctx.userTier = await logic.getUserTier(db, userId, guildId);
            ctx.userFlux = await logic.getLocalFlux(db, userId, guildId);

            // Active Reward: Message (Max 1 per 6 mins)
            if (ctx.message) {
                const now = Date.now();
                const row = await db.queryOne(
                    'SELECT last_activity FROM user_trust_flux WHERE user_id = $1 AND guild_id = $2',
                    [userId, guildId]
                );
                const lastTime = row ? new Date(row.last_activity).getTime() : 0;

                if (now - lastTime > 360000) { // 6 mins
                    await logic.modifyFlux(db, userId, guildId, 1, 'activity');
                }
            }
        }
        await next();
    });

    // Command: /myflux
    bot.command("myflux", async (ctx) => {
        if (ctx.chat.type === 'private') {
            await ui.sendGlobalFluxOverview(ctx, db);
        } else {
            await ui.sendMyFlux(ctx, db);
        }
    });

    // Command: /tier
    bot.command("tier", async (ctx) => {
        await ui.sendTierMenu(ctx);
    });

    // Callback handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;

        if (data === "tier_close") {
            await ctx.deleteMessage();
            return;
        }

        if (data === "tier_menu") {
            await ui.sendTierMenu(ctx, true);
            return;
        }

        if (data.startsWith("tier_detail:")) {
            const tierNum = parseInt(data.split(":")[1]);
            await ui.sendTierDetail(ctx, tierNum);
            return;
        }

        if (data === "tier_flux_calc" || data === "tier_explainer") {
            const back = data === "tier_explainer" ? "back_to_start" : null;
            await ui.sendFluxCalculation(ctx, true, back);
            return;
        }

        if (data === "tier_explainer:overview") {
            await ui.sendFluxCalculation(ctx, true, "my_flux_overview");
            return;
        }

        if (data === "my_flux_overview") {
            await ui.sendGlobalFluxOverview(ctx, db);
            return;
        }

        await next();
    });
}

module.exports = {
    registerCommands
};
