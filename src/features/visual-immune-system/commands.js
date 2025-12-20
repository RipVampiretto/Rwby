const logic = require('./logic');
const ui = require('./ui');
const { isAdmin, isFromSettingsMenu } = require('../../utils/error-handlers');

function registerCommands(bot, db) {
    // Handler: photos and stickers
    // NOTE: DISABLED TEMPORARILY IN ORIGINAL CODE. 
    // I will preserve the disabled state or logic structure as requested
    // The original code had: "VISUAL IMMUNE SYSTEM DISABLED TEMPORARILY"
    // I should probably keep it disabled if that was the state, effectively doing nothing but calling next().
    // However, for refactoring I should implement the logic but maybe comment out the registration or guard it.
    // The original code has `return next(); // DISABLED` at the top of the handler.

    bot.on(["message:photo", "message:sticker"], async (ctx, next) => {
        return next(); // DISABLED as per original

        /* 
        if (ctx.chat.type === 'private') return next();
        if (await isAdmin(ctx, 'visual-immune-system')) return next();

        const config = db.getGuildConfig(ctx.chat.id);
        if (!config.visual_enabled) return next();

        const tierBypass = config.visual_tier_bypass ?? 2;
        if (ctx.userTier !== undefined && ctx.userTier >= tierBypass) return next();

        await logic.processVisual(ctx, db, config);
        await next();
        */
    });

    bot.command("visualconfig", async (ctx) => {
        return ctx.reply("⚠️ Visual Immune System è temporaneamente disabilitato.");
        /*
        if (ctx.chat.type === 'private') return;
        if (!await isAdmin(ctx, 'visual-immune-system')) return;
        await ui.sendConfigUI(ctx, db);
        */
    });

    bot.command("visualban", async (ctx) => {
        return ctx.reply("⚠️ Visual Immune System è temporaneamente disabilitato.");
    });

    // UI Callback
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("vis_")) return next();

        // If config is needed for callback logic
        const config = db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === "vis_close") return ctx.deleteMessage();

        if (data === "vis_toggle") {
            db.updateGuildConfig(ctx.chat.id, { visual_enabled: config.visual_enabled ? 0 : 1 });
        } else if (data === "vis_sync") {
            db.updateGuildConfig(ctx.chat.id, { visual_sync_global: config.visual_sync_global ? 0 : 1 });
        } else if (data === "vis_thr") {
            let thr = config.visual_hamming_threshold || 5;
            thr = thr >= 15 ? 1 : thr + 1;
            db.updateGuildConfig(ctx.chat.id, { visual_hamming_threshold: thr });
        } else if (data === "vis_act") {
            const acts = ['delete', 'ban', 'report_only'];
            let cur = config.visual_action || 'delete';
            if (!acts.includes(cur)) cur = 'delete';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 3];
            db.updateGuildConfig(ctx.chat.id, { visual_action: nextAct });
        }

        await ui.sendConfigUI(ctx, db, true, fromSettings);
    });
}

module.exports = {
    registerCommands
};
