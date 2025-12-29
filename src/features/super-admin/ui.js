const {
    calculateTrend,
    formatMonthYear,
    getPreviousMonth,
    getNextMonth,
    getCurrentMonthYear,
    ACTIVE_USER_THRESHOLD,
    ACTIVE_GUILD_THRESHOLD
} = require('../analytics/monthly-stats');

async function sendGovernancePanel(ctx, stats) {
    const fmt = n => (n || 0).toLocaleString('it-IT');
    const text =
        `🌍 <b>GLOBAL GOVERNANCE PANEL</b>\n\n` +
        `🏛️ <b>Network Overview</b>\n` +
        `• Active Guilds: <b>${fmt(stats.guilds_count)}</b>\n` +
        `• Total Users: <b>${fmt(stats.users_count)}</b>\n` +
        `• Global Bans: <b>${fmt(stats.global_bans)}</b>\n\n` +
        `<i>Select an option to view detailed statistics or manage configuration.</i>`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '📊 View Full Statistics', callback_data: 'g_stats' }],
            [{ text: '📈 Monthly Analytics', callback_data: 'g_analytics' }],
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

/**
 * Send monthly analytics panel with navigation
 * @param {object} ctx - Grammy context
 * @param {object} stats - Current month stats
 * @param {string} monthYear - Current month in YYYY-MM format
 * @param {object|null} prevStats - Previous month stats for trend calculation
 */
async function sendMonthlyAnalytics(ctx, stats, monthYear, prevStats) {
    const fmt = n => (n || 0).toLocaleString('it-IT');
    const currentMonth = getCurrentMonthYear();
    const formattedMonth = formatMonthYear(monthYear);

    // Calculate trends
    const newUsersTrend = calculateTrend(stats.new_users, prevStats?.new_users);
    const activeUsersTrend = calculateTrend(stats.active_users, prevStats?.active_users);
    const newGuildsTrend = calculateTrend(stats.new_guilds, prevStats?.new_guilds);
    const lostGuildsTrend = calculateTrend(stats.lost_guilds, prevStats?.lost_guilds);
    const activeGuildsTrend = calculateTrend(stats.active_guilds, prevStats?.active_guilds);
    const bansTrend = calculateTrend(stats.global_bans, prevStats?.global_bans);

    const text =
        `📈 <b>ANALYTICS - ${formattedMonth}</b>\n` +
        `───────────────\n\n` +
        `👥 <b>UTENTI</b>\n` +
        `• Nuovi: <b>${fmt(stats.new_users)}</b> ${newUsersTrend.emoji} ${newUsersTrend.text}\n` +
        `• Attivi (≥${ACTIVE_USER_THRESHOLD} msg): <b>${fmt(stats.active_users)}</b> ${activeUsersTrend.emoji} ${activeUsersTrend.text}\n\n` +
        `🏛️ <b>GRUPPI</b>\n` +
        `• Nuovi: <b>${fmt(stats.new_guilds)}</b> ${newGuildsTrend.emoji} ${newGuildsTrend.text}\n` +
        `• Persi: <b>${fmt(stats.lost_guilds)}</b> ${lostGuildsTrend.emoji} ${lostGuildsTrend.text}\n` +
        `• Attivi (≥${ACTIVE_GUILD_THRESHOLD} msg): <b>${fmt(stats.active_guilds)}</b> ${activeGuildsTrend.emoji} ${activeGuildsTrend.text}\n\n` +
        `🛡️ <b>MODERAZIONE</b>\n` +
        `• Global Bans: <b>${fmt(stats.global_bans)}</b> ${bansTrend.emoji} ${bansTrend.text}\n` +
        `• Votebans completati: <b>${fmt(stats.completed_votes)}</b>\n\n` +
        `<i>Trend rispetto al mese precedente</i>`;

    // Build navigation keyboard
    const prevMonth = getPreviousMonth(monthYear);
    const nextMonth = getNextMonth(monthYear);
    const canGoNext = nextMonth <= currentMonth;

    const navRow = [];
    navRow.push({ text: `← ${formatMonthYear(prevMonth).split(' ')[0]}`, callback_data: `g_analytics:${prevMonth}` });
    navRow.push({ text: `📅 ${formattedMonth.split(' ')[0]}`, callback_data: `g_analytics:${monthYear}` });
    if (canGoNext) {
        navRow.push({
            text: `${formatMonthYear(nextMonth).split(' ')[0]} →`,
            callback_data: `g_analytics:${nextMonth}`
        });
    }

    const keyboard = {
        inline_keyboard: [
            navRow,
            [{ text: '🔄 Aggiorna', callback_data: `g_analytics_refresh:${monthYear}` }],
            [{ text: '🔙 Back to Menu', callback_data: 'g_menu' }]
        ]
    };

    return ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
}

module.exports = {
    sendGovernancePanel,
    sendFullStats,
    sendMonthlyAnalytics
};
