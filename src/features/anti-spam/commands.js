const stats = require('./stats');
const detection = require('./detection');
const actions = require('./actions');
const ui = require('./ui');
const { isAdmin } = require('../../utils/error-handlers');

function registerCommands(bot, db) {
    // Middleware: spam detection
    bot.on('message:text', async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Check Tier (Bypass for Tier 2+)
        if (ctx.userTier && ctx.userTier >= 2) return next();

        // Check if Enabled
        const config = db.getGuildConfig(ctx.chat.id);
        if (!config.spam_enabled) return next();

        const userId = ctx.from.id;
        const guildId = ctx.chat.id;
        const now = Date.now();
        const content = ctx.message.text;

        // Admin Bypass
        if (await isAdmin(ctx, 'anti-spam')) return next();

        // Stats Logic
        const userStats = stats.getStats(userId, guildId);

        const lastTs = userStats.last_msg_ts ? new Date(userStats.last_msg_ts).getTime() : 0;
        const diff = now - lastTs;

        // Reset counters if time passed
        if (diff > 60000) userStats.msg_count_60s = 0;
        if (diff > 10000) userStats.msg_count_10s = 0;

        userStats.msg_count_60s++;
        userStats.msg_count_10s++;

        // Repetition check
        if (userStats.last_msg_content === content) {
            userStats.duplicate_count++;
        } else {
            userStats.duplicate_count = 0;
        }

        // Update stats active values
        userStats.last_msg_content = content;
        userStats.last_msg_ts = new Date().toISOString();

        stats.updateStats(userStats);

        // Check Spam
        const result = detection.checkSpamLimits(userStats, config);
        if (result.triggered) {
            await actions.executeAction(ctx, result.action, result.trigger);
            return; // Stop processing
        }

        await next();
    });

    // Action Handlers
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith('spam_')) return next();

        // Format: spam_ACTION:FROM_SETTINGS (0 or 1)
        const [actionKey, fromSettingsFlag] = data.split(':');
        const fromSettings = fromSettingsFlag === '1';
        const action = actionKey.replace('spam_', '');
        const config = db.getGuildConfig(ctx.chat.id);

        if (action === 'close') {
            await ctx.deleteMessage();
            return;
        } else if (action === 'toggle') {
            await db.updateGuildConfig(ctx.chat.id, { spam_enabled: config.spam_enabled ? 0 : 1 });
        } else if (action === 'sens') {
            const levels = ['low', 'medium', 'high'];
            const currentIdx = levels.indexOf(config.spam_sensitivity || 'medium');
            const nextLevel = levels[(currentIdx + 1) % 3];
            await db.updateGuildConfig(ctx.chat.id, { spam_sensitivity: nextLevel });
        } else if (action === 'act_vol') {
            const acts = ['delete', 'ban', 'report_only'];
            const idx = acts.indexOf(config.spam_action_volume || 'delete');
            await db.updateGuildConfig(ctx.chat.id, { spam_action_volume: acts[(idx + 1) % 3] });
        } else if (action === 'act_rep') {
            const acts = ['delete', 'ban', 'report_only'];
            const idx = acts.indexOf(config.spam_action_repetition || 'delete');
            await db.updateGuildConfig(ctx.chat.id, { spam_action_repetition: acts[(idx + 1) % 3] });
        }

        await ui.sendConfigUI(ctx, db, true, fromSettings);
    });
}

module.exports = {
    registerCommands
};
