async function sendGovernancePanel(ctx, stats) {
    const text =
        `🌍 <b>GLOBAL GOVERNANCE PANEL</b>\n\n` +
        `🏛️ <b>Network Overview</b>\n` +
        `• Active Guilds: <b>${stats.guilds_count}</b>\n` +
        `• Total Users: <b>${stats.users_count}</b>\n` +
        `• Global Bans: <b>${stats.global_bans}</b>\n\n` +
        `<i>Select an option to view detailed statistics or manage configuration.</i>`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '📊 View Full Statistics', callback_data: 'g_stats' }],
            [{ text: '❌ Close Panel', callback_data: 'g_close' }]
        ]
    };

    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    }
}

function sendFullStats(ctx, stats) {
    // Format numbers
    const fmt = n => parseFloat(n).toLocaleString('en-US', { maximumFractionDigits: 1 });

    const text =
        `📊 <b>DETAILED STATISTICS</b>\n` +
        `───────────────\n\n` +
        `👥 <b>Userbase</b>\n` +
        `• Registered Users: <b>${fmt(stats.users_count)}</b>\n` +
        `• Banned Users: <b>${fmt(stats.global_bans)}</b>\n` +
        `• Active Guilds: <b>${fmt(stats.guilds_count)}</b>\n\n` +
        `💠 <b>Flux Reputation System</b>\n` +
        `<b>Local (Per-Group)</b>\n` +
        `   • Average: <b>${fmt(stats.avg_local_flux)}</b>\n` +
        `   • Total: <b>${fmt(stats.total_local_flux)}</b>\n\n` +
        `<b>Global (Network-Wide)</b>\n` +
        `   • Average: <b>${fmt(stats.avg_global_flux)}</b>\n` +
        `   • Total: <b>${fmt(stats.total_global_flux)}</b>\n\n` +
        `🛡️ <b>Security Metrics</b>\n` +
        `• Whitelisted Domains: <b>${stats.whitelist_count}</b>\n` +
        `• Blacklisted Domains: <b>${stats.blacklist_count}</b>\n` +
        `• Active VoteBans: <b>${stats.active_votes}</b>`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '🔄 Refresh', callback_data: 'g_stats' }],
            [{ text: '🔙 Back to Menu', callback_data: 'g_menu' }]
        ]
    };

    return ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
}

module.exports = {
    sendGovernancePanel,
    sendFullStats
};
