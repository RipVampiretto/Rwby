const logic = require('./logic');
const actions = require('./actions');
const ui = require('./ui');
const manage = require('./manage');
const { isAdmin, isFromSettingsMenu } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');

function registerCommands(bot, db) {
    // Middleware: check messages against modals
    bot.on("message:text", async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip admins
        if (await isAdmin(ctx, 'modal-patterns')) return next();

        // Config check
        const config = db.getGuildConfig(ctx.chat.id);
        if (!config.modal_enabled) return next();

        // Tier bypass (-1 = OFF, no bypass)
        const tierBypass = config.modal_tier_bypass ?? 2;
        if (tierBypass !== -1 && ctx.userTier !== undefined && ctx.userTier >= tierBypass) return next();

        // Check against modals
        const match = await logic.checkMessageAgainstModals(ctx, config);
        if (match) {
            await actions.executeAction(ctx, match.action, match.category, match.pattern, match.similarity);
        }

        await next();
    });

    // Command: /modalconfig (group admins)
    bot.command("modalconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        if (!await isAdmin(ctx, 'modal-patterns')) return;

        await ui.sendConfigUI(ctx, db);
    });

    // UI Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("mdl_")) return next();

        const config = db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === "mdl_close") return ctx.deleteMessage();

        if (data === "mdl_toggle") {
            db.updateGuildConfig(ctx.chat.id, { modal_enabled: config.modal_enabled ? 0 : 1 });
        } else if (data === "mdl_act") {
            const acts = ['report_only', 'delete', 'ban'];
            let cur = config.modal_action || 'report_only';
            if (!acts.includes(cur)) cur = 'report_only';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 3];
            db.updateGuildConfig(ctx.chat.id, { modal_action: nextAct });
        } else if (data === "mdl_tier") {
            const tiers = [0, 1, 2, 3, -1];
            let cur = config.modal_tier_bypass ?? 2;
            const idx = tiers.indexOf(cur);
            const nextTier = tiers[(idx + 1) % tiers.length];
            db.updateGuildConfig(ctx.chat.id, { modal_tier_bypass: nextTier });
        } else if (data === "mdl_list") {
            await ui.sendModalListUI(ctx, db, true, fromSettings);
            return;
        } else if (data === "mdl_back") {
            await ui.sendConfigUI(ctx, db, true, fromSettings);
            return;
        } else if (data.startsWith("mdl_tog:")) {
            const modalId = parseInt(data.split(':')[1]);
            manage.toggleGuildModal(ctx.chat.id, modalId);
            await ui.sendModalListUI(ctx, db, true, fromSettings);
            return;
        }

        await ui.sendConfigUI(ctx, db, true, fromSettings);
    });

    logger.info('[modal-patterns] Module registered');
}

module.exports = {
    registerCommands
};
