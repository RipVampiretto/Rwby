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
    text += ctx.t('tier_system.details.flux_required', { range: info.fluxRange }) + '\n\n';

    if (info.restrictions.length > 0) {
        text += `${ctx.t('tier_system.details.restrictions_title')}\n`;
        info.restrictions.forEach(r => (text += `• ${ctx.t('tier_system.details.items.' + r)}\n`));
    }



    text += `\n\n${ctx.t('tier_system.details.how_to_advance')}`;

    const keyboard = {
        inline_keyboard: [
            [{ text: ctx.t('tier_system.menu.buttons.back'), callback_data: 'tier_menu' }],
            [{ text: ctx.t('tier_system.menu.buttons.close'), callback_data: 'tier_close' }]
        ]
    };

    try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
    } catch (e) { }
}

async function sendFluxCalculation(ctx, isEdit = false, backCallback = null) {
    const p = 'tier_system.flux_calc.';
    const text =
        `${ctx.t(p + 'title')}\n\n` +
        `${ctx.t(p + 'intro')}\n\n` +
        `${ctx.t(p + 'earning_title')}\n${ctx.t(p + 'earning_items')}\n\n` +
        `${ctx.t(p + 'losing_title')}\n${ctx.t(p + 'losing_items')}\n\n` +
        `${ctx.t(p + 'thresholds_title')}\n${ctx.t(p + 'thresholds_items')}\n\n` +
        `${ctx.t(p + 'cap')}`;

    const keyboard = {
        inline_keyboard: []
    };

    if (backCallback) {
        keyboard.inline_keyboard.push([{ text: ctx.t('common.back'), callback_data: backCallback }]);
    } else {
        keyboard.inline_keyboard.push([{ text: ctx.t('tier_system.menu.buttons.close'), callback_data: 'tier_close' }]);
    }

    if (isEdit) {
        try {
            await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
        } catch (e) { }
    } else {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
}

async function sendMyFlux(ctx, db) {
    if (!ctx.from || ctx.chat.type === 'private') return;

    const userId = ctx.from.id;
    const guildId = ctx.chat.id;
    const localFlux = await logic.getLocalFlux(db, userId, guildId);
    const globalFlux = await logic.getGlobalFlux(db, userId);
    const tier = await logic.getUserTier(db, userId, guildId);
    const tierInfo = logic.TIER_INFO[tier];

    const nextTierFlux = tier < 3 ? logic.TIER_THRESHOLDS[`TIER_${tier + 1}`] : null;
    const progress = nextTierFlux ? Math.min(10, Math.max(0, Math.floor((localFlux / nextTierFlux) * 10))) : 10;
    const progressBar = '█'.repeat(progress) + '░'.repeat(10 - progress);

    const title = ctx.t('tier_system.my_flux.title');
    const rankText = ctx.t('tier_system.menu.your_rank', {
        emoji: tierInfo.emoji,
        name: ctx.t(`tier_system.tiers.${tier}.name`)
    });
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

    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
}

async function sendGlobalFluxOverview(ctx, db) {
    if (!ctx.from) return;
    const userId = ctx.from.id;

    // Get Global Flux
    const globalFlux = await logic.getGlobalFlux(db, userId);

    // Get all Guilds Flux (async PostgreSQL)
    const rows = await db.queryAll(
        `
        SELECT g.guild_name, u.guild_id, u.local_flux 
        FROM user_trust_flux u 
        JOIN guild_config g ON u.guild_id = g.guild_id 
        WHERE u.user_id = $1 
        ORDER BY u.local_flux DESC
    `,
        [userId]
    );

    const title = ctx.t('tier_system.my_flux.title');
    let text = `${title}\n\n`;

    if (rows.length === 0) {
        text += ctx.t('tier_system.my_flux.no_data');
    } else {
        for (const row of rows) {
            const flux = row.local_flux;
            // Calculate Tier manually
            let tier = 0;
            if (flux >= logic.TIER_THRESHOLDS.TIER_3) tier = 3;
            else if (flux >= logic.TIER_THRESHOLDS.TIER_2) tier = 2;
            else if (flux >= logic.TIER_THRESHOLDS.TIER_1) tier = 1;

            const tierInfo = logic.TIER_INFO[tier];
            const tierName = ctx.t(`tier_system.tiers.${tier}.name`);
            const nextTierFlux = tier < 3 ? logic.TIER_THRESHOLDS[`TIER_${tier + 1}`] : 0;
            let progress = 10;
            if (tier < 3 && nextTierFlux > 0) {
                progress = Math.min(10, Math.max(0, Math.floor((flux / nextTierFlux) * 10)));
            }
            const progressBar = '█'.repeat(progress) + '░'.repeat(10 - progress);
            const target = tier < 3 ? nextTierFlux : 'MAX';

            text += `🏘 **${row.guild_name || 'Unknown Group'}**\n`;
            text += `${ctx.t('tier_system.menu.your_rank', { emoji: tierInfo.emoji, name: tierName })}\n`;
            text += `🏠 Flux: ${flux}\n`;
            text += `${progressBar} ${flux}/${target}\n\n`;
        }
    }

    text += `**Global**\n🌍 Totale: ${globalFlux}`;

    const keyboard = {
        inline_keyboard: [
            [{ text: `${ctx.t('tier_system.menu.buttons.flux_works')}`, callback_data: 'tier_explainer:overview' }],
            [{ text: ctx.t('common.back'), callback_data: 'back_to_start' }]
        ]
    };

    if (ctx.callbackQuery) {
        try {
            await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
        } catch (e) { }
    } else {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
}

module.exports = {
    sendTierMenu,
    sendTierDetail,
    sendFluxCalculation,
    sendMyFlux,
    sendGlobalFluxOverview
};
