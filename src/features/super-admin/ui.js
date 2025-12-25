async function sendGovernancePanel(ctx, stats) {
    const text =
        `🌍 <b>GLOBAL GOVERNANCE PANEL</b>\n` +
        `🏛️ Gruppi: ${stats.guilds || 0}\n` +
        `🚫 Ban globali: ${stats.global_bans || 0}`;

    const keyboard = {
        inline_keyboard: [
            [
                { text: '📊 Statistiche Rete', callback_data: 'g_stats' },
                { text: '🛠️ Configurazione', callback_data: 'g_config' }
            ],
            [{ text: '❌ Chiudi', callback_data: 'g_close' }]
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
        `📊 <b>NETWORK STATISTICS</b>\n\n` +
        `🏛️ Active Guilds: ${stats.guilds || 0}\n` +
        `🚫 Global Bans: ${stats.global_bans || 0}`;

    const keyboard = {
        inline_keyboard: [[{ text: '🔙 Indietro', callback_data: 'g_menu' }]]
    };

    return ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
}

module.exports = {
    sendGovernancePanel,
    sendFullStats
};
