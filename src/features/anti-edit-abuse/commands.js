const snapshots = require('./snapshots');
const core = require('./core');
const ui = require('./ui');
const userReputation = require('../user-reputation');
const { isFromSettingsMenu } = require('../../utils/error-handlers');

async function isUserAdmin(ctx) {
    const member = await ctx.getChatMember(ctx.from.id);
    return ['creator', 'administrator'].includes(member.status);
}

function registerCommands(bot, db) {
    // Store snapshot on new message
    bot.on("message:text", async (ctx, next) => {
        if (ctx.chat.type !== 'private') {
            snapshots.saveSnapshot(ctx.message);
        }
        await next();
    });

    // Handler: edited messages
    bot.on("edited_message", async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip admins
        if (await isUserAdmin(ctx)) return next();

        // Config check
        const config = db.getGuildConfig(ctx.chat.id);
        if (!config.edit_monitor_enabled) return next();

        // Tier bypass check
        const tierBypass = config.edit_tier_bypass ?? 2;
        const userTier = userReputation.getUserTier(ctx.from.id, ctx.chat.id);
        if (tierBypass !== -1 && userTier >= tierBypass) return next();

        await core.processEdit(ctx, config);
        await next();
    });

    // UI Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("edt_")) return next();

        const config = db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === "edt_close") return ctx.deleteMessage();

        if (data === "edt_toggle") {
            await db.updateGuildConfig(ctx.chat.id, { edit_monitor_enabled: config.edit_monitor_enabled ? 0 : 1 });
        } else if (data === "edt_thr") {
            let thr = config.edit_similarity_threshold || 0.5;
            thr = thr >= 0.9 ? 0.1 : thr + 0.1;
            await db.updateGuildConfig(ctx.chat.id, { edit_similarity_threshold: parseFloat(thr.toFixed(1)) });
        } else if (data === "edt_act_inj") {
            const acts = ['delete', 'ban', 'report_only'];
            let cur = config.edit_link_injection_action || 'ban';
            if (!acts.includes(cur)) cur = 'ban';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 3];
            await db.updateGuildConfig(ctx.chat.id, { edit_link_injection_action: nextAct });
        } else if (data === "edt_act_gen") {
            const acts = ['delete', 'ban', 'report_only'];
            let cur = config.edit_abuse_action || 'report_only';
            if (!acts.includes(cur)) cur = 'report_only';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 3];
            await db.updateGuildConfig(ctx.chat.id, { edit_abuse_action: nextAct });
        } else if (data === "edt_tier") {
            // Cycle through 0, 1, 2, 3, -1 (OFF)
            const current = config.edit_tier_bypass ?? 2;
            const tiers = [0, 1, 2, 3, -1];
            const idx = tiers.indexOf(current);
            const next = tiers[(idx + 1) % tiers.length];
            await db.updateGuildConfig(ctx.chat.id, { edit_tier_bypass: next });
        }

        await ui.sendConfigUI(ctx, db, true, fromSettings);
    });
}

module.exports = {
    registerCommands
};
