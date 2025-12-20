const trust = require('./trust');

async function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    const guildStats = trust.getGuildTrust(ctx.chat.id);
    const tierName = ['New', 'Verified', 'Trusted', 'Authority'][guildStats.tier] || 'Unknown';

    const text = `🌐 **INTEL NETWORK STATUS**\n\n` +
        `🏷️ Tier Gruppo: ${guildStats.tier} (${tierName})\n` +
        `📊 Trust Score: ${guildStats.trust_score}/100\n` +
        `✅ Contributi validi: ${guildStats.contributions_valid}\n` +
        `❌ Contributi invalidi: ${guildStats.contributions_invalid}`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "intel_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: "🔄 Sync Ban: ON", callback_data: "intel_noop" }, { text: "🔄 Sync Link: ON", callback_data: "intel_noop" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        try { await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' }); } catch (e) { }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = {
    sendConfigUI
};
