const logic = require('./logic');

async function sendTierMenu(ctx, isEdit = false) {
    // Simplified: directly show Flux calculation info
    await sendFluxCalculation(ctx, isEdit);
}

async function sendTierDetail(ctx, tierNum) {
    const info = logic.TIER_INFO[tierNum];
    if (!info) return;

    const tierName = ctx.t(`tier_system.tiers.${tierNum}.name`);
    let text = `**${info.emoji} ${tierName}**\n`;
    text += ctx.t('tier_system.details.flux_required', { range: info.fluxRange }) + "\n\n";

    if (info.restrictions.length > 0) {
        text += `${ctx.t('tier_system.details.restrictions_title')}\n`;
        info.restrictions.forEach(r => text += `• ${ctx.t('tier_system.details.items.' + r)}\n`);
    }

    if (info.bypasses.length > 0) {
        text += `\n${ctx.t('tier_system.details.bypasses_title')}\n`;
        info.bypasses.forEach(b => text += `• ${ctx.t('tier_system.details.items.' + b)}\n`);
    } else {
        text += `\n${ctx.t('tier_system.details.bypasses_title')} ${ctx.t('tier_system.details.bypasses_none')}`;
    }

    text += `\n\n${ctx.t('tier_system.details.how_to_advance')}`;

    const keyboard = {
        inline_keyboard: [
            [{ text: ctx.t('tier_system.menu.buttons.back'), callback_data: "tier_menu" }],
            [{ text: ctx.t('tier_system.menu.buttons.close'), callback_data: "tier_close" }]
        ]
    };

    try {
        await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
    } catch (e) { }
}

async function sendFluxCalculation(ctx, isEdit = false) {
    const p = 'tier_system.flux_calc.';
    const text = `${ctx.t(p + 'title')}\n\n` +
        `${ctx.t(p + 'intro')}\n\n` +
        `${ctx.t(p + 'earning_title')}\n${ctx.t(p + 'earning_items')}\n\n` +
        `${ctx.t(p + 'losing_title')}\n${ctx.t(p + 'losing_items')}\n\n` +
        `${ctx.t(p + 'thresholds_title')}\n${ctx.t(p + 'thresholds_items')}\n\n` +
        `${ctx.t(p + 'cap')}`;

    const keyboard = {
        inline_keyboard: [
            [{ text: ctx.t('tier_system.menu.buttons.close'), callback_data: "tier_close" }]
        ]
    };

    if (isEdit) {
        try { await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard }); } catch (e) { }
    } else {
        await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
    }
}

async function sendMyFlux(ctx, db) {
    if (!ctx.from || ctx.chat.type === 'private') return;

    const userId = ctx.from.id;
    const guildId = ctx.chat.id;
    const localFlux = logic.getLocalFlux(db, userId, guildId);
    const globalFlux = logic.getGlobalFlux(db, userId);
    const tier = logic.getUserTier(db, userId, guildId);
    const tierInfo = logic.TIER_INFO[tier];

    const nextTierFlux = tier < 3 ? logic.TIER_THRESHOLDS[`TIER_${tier + 1}`] : null;
    const progress = nextTierFlux ? Math.min(10, Math.max(0, Math.floor((localFlux / nextTierFlux) * 10))) : 10;
    const progressBar = '█'.repeat(progress) + '░'.repeat(10 - progress);

    const title = ctx.t('tier_system.my_flux.title');
    const rankText = ctx.t('tier_system.menu.your_rank', { emoji: tierInfo.emoji, name: ctx.t(`tier_system.tiers.${tier}.name`) });
    const locGlob = ctx.t('tier_system.my_flux.local_global', { local: localFlux, global: globalFlux });

    let text = `${title}\n\n`;
    text += `${rankText}\n`;
    text += `${locGlob}\n\n`;
    text += `${progressBar} ${localFlux}/${nextTierFlux || 'MAX'}`;

    const keyboard = {
        inline_keyboard: [
            [{ text: ctx.t('tier_system.menu.buttons.view_details'), callback_data: `tier_detail:${tier}` }]
        ]
    };

    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
}

module.exports = {
    sendTierMenu,
    sendTierDetail,
    sendFluxCalculation,
    sendMyFlux
};
