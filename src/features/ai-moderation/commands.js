const { sendConfigUI, sendCategoryConfigUI } = require('./ui');
const { testConnection, callLLM } = require('./api');
const { isFromSettingsMenu, isSuperAdmin } = require('../../utils/error-handlers');

/**
 * Check if user is admin
 */
async function isAdmin(ctx, source) {
    try {
        const member = await ctx.getChatMember(ctx.from.id);
        return ['creator', 'administrator'].includes(member.status);
    } catch (e) {
        return false;
    }
}

function registerCommands(bot, db) {
    // Command: /testai - Super Admin only, health check for AI connection
    bot.command('testai', async ctx => {
        if (!isSuperAdmin(ctx.from.id)) {
            return ctx.reply('❌ Solo super admin possono usare questo comando.');
        }

        await ctx.reply('🔄 Testing AI connection...');

        try {
            const startTime = Date.now();
            const result = await callLLM(
                'Hello, this is a test message.',
                [],
                { ai_confidence_threshold: 0.5 },
                process.env.LM_STUDIO_NSFW_MODEL
            );
            const latency = Date.now() - startTime;

            const status = result && result.category ? '✅ OK' : '❌ FAILED';
            const response =
                `🤖 **AI HEALTH CHECK**\n\n` +
                `Status: ${status}\n` +
                `Latency: ${latency}ms\n` +
                `Response Category: \`${result?.category || 'N/A'}\`\n` +
                `Confidence: \`${result?.confidence ? Math.round(result.confidence * 100) + '%' : 'N/A'}\``;

            await ctx.reply(response, { parse_mode: 'Markdown' });
        } catch (e) {
            await ctx.reply(`❌ **AI HEALTH CHECK FAILED**\n\nError: ${e.message}`, { parse_mode: 'Markdown' });
        }
    });

    // Action Handlers
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith('ai_')) return next();

        const config = await db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === 'ai_close') return ctx.deleteMessage();

        if (data === 'ai_toggle') {
            await db.updateGuildConfig(ctx.chat.id, { ai_enabled: config.ai_enabled ? 0 : 1 });
        } else if (data === 'ai_test_conn') {
            await testConnection(ctx);
            return; // Don't refresh UI immediately, testConnection sends a message
        } else if (data === 'ai_ctx') {
            await db.updateGuildConfig(ctx.chat.id, { ai_context_aware: config.ai_context_aware ? 0 : 1 });
        } else if (data === 'ai_tier_bypass') {
            // Cycle through 0, 1, 2, 3, -1 (OFF)
            const current = config.ai_tier_bypass ?? 2;
            const tiers = [0, 1, 2, 3, -1];
            const idx = tiers.indexOf(current);
            const next = tiers[(idx + 1) % tiers.length];
            await db.updateGuildConfig(ctx.chat.id, { ai_tier_bypass: next });
        } else if (data === 'ai_threshold') {
            let thr = config.ai_confidence_threshold || 0.75;
            thr = thr >= 0.9 ? 0.5 : thr + 0.05;
            await db.updateGuildConfig(ctx.chat.id, { ai_confidence_threshold: parseFloat(thr.toFixed(2)) });
        } else if (data === 'ai_config_cats') {
            return sendCategoryConfigUI(ctx, db, fromSettings);
        } else if (data.startsWith('ai_set_act:')) {
            // act:CAT:NEXT_ACTION
            const parts = data.split(':');
            if (parts.length === 2) {
                const cat = parts[1];
                const key = `ai_action_${cat}`;
                // Actions: delete, ban, report_only
                const actions = ['delete', 'ban', 'report_only'];
                let current = config[key] || 'report_only';
                if (!actions.includes(current)) current = 'report_only';
                const nextAct = actions[(actions.indexOf(current) + 1) % 3];
                await db.updateGuildConfig(ctx.chat.id, { [key]: nextAct });
                return sendCategoryConfigUI(ctx, db, fromSettings); // Stay in sub-menu
            }
        } else if (data === 'ai_back_main') {
            return sendConfigUI(ctx, db, true, fromSettings);
        }

        await sendConfigUI(ctx, db, true, fromSettings);
    });
}

module.exports = {
    registerCommands
};
