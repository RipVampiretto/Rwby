async function sendGovernancePanel(ctx, stats) {
    const text =
        `🌍 **GLOBAL GOVERNANCE PANEL**\n` +
        `🏛️ Gruppi: ${stats.guilds}\n` +
        `🚫 Ban globali: ${stats.global_bans}\n` +
        `📜 Bills pending: ${stats.pending_bills}`;

    const keyboard = {
        inline_keyboard: [
            [
                { text: '📜 Bills Pendenti', callback_data: 'g_bills' },
                { text: '📊 Statistiche Rete', callback_data: 'g_stats' }
            ],
            [
                { text: '🛠️ Configurazione', callback_data: 'g_config' },
                { text: '❌ Chiudi', callback_data: 'g_close' }
            ]
        ]
    };

    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    }
}

function sendFullStats(ctx, stats) {
    const text =
        `📊 **NETWORK STATISTICS**\n\n` +
        `🏛️ Active Guilds: ${stats.guilds}\n` +
        `🚫 Global Bans: ${stats.global_bans}\n` +
        `📜 Pending Bills: ${stats.pending_bills}\n` +
        `🤝 Avg Network Trust: ${Math.round(stats.avg_trust || 0)}/100`;

    const keyboard = {
        inline_keyboard: [[{ text: '🔙 Indietro', callback_data: 'g_menu' }]]
    };

    return ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
}

module.exports = {
    sendGovernancePanel,
    sendFullStats
};
