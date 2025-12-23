const { getGuildConfig, updateGuildConfig } = require('../../database/repos/guild');
const logger = require('../../middlewares/logger');
const ui = require('./ui');
const wizard = require('./wizard');

async function handleCallback(ctx) {
    const data = ctx.callbackQuery.data;

    // Navigation
    if (data.startsWith('wc_goto:')) {
        const target = data.split(':')[1];
        logger.info(`[Welcome] Navigation to: ${target}`);

        try {
            if (target === 'main') {
                await ui.sendWelcomeMenu(ctx, true);
            } else if (target === 'modes') {
                await ui.sendCaptchaModeMenu(ctx);
            } else if (target === 'preview') {
                await ui.sendPreview(ctx);
            }
        } catch (e) {
            logger.error(`[Welcome] Navigation error: ${e.message}`);
        }
        try {
            await ctx.answerCallbackQuery();
        } catch (e) { }
        return;
    }

    // Toggle
    if (data.startsWith('wc_toggle:')) {
        const parts = data.split(':');
        const type = parts[1]; // captcha | msg
        const val = parseInt(parts[2]); // 0 | 1

        logger.info(`[Welcome] Toggle: type=${type}, val=${val}, chat=${ctx.chat.id}`);

        try {
            if (type === 'captcha') {
                await updateGuildConfig(ctx.chat.id, { captcha_enabled: val });
            } else if (type === 'msg') {
                await updateGuildConfig(ctx.chat.id, { welcome_msg_enabled: val });
            } else if (type === 'rules') {
                await updateGuildConfig(ctx.chat.id, { rules_enabled: val });
            } else if (type === 'logs') {
                await updateGuildConfig(ctx.chat.id, { captcha_logs_enabled: val });
            }
            logger.info(`[Welcome] Toggle update complete, refreshing UI`);
            await ui.sendWelcomeMenu(ctx, true);
        } catch (e) {
            logger.error(`[Welcome] Toggle error: ${e.message}`);
            console.error(e);
        }
        try {
            await ctx.answerCallbackQuery();
        } catch (e) { }
        return;
    }

    // Toggle Mode (Multi-select)
    if (data.startsWith('wc_toggle_mode:')) {
        const modeToToggle = data.split(':')[1];
        const config = await getGuildConfig(ctx.chat.id);
        let currentModes = (config.captcha_mode || 'button').split(',');

        if (currentModes.includes(modeToToggle)) {
            // Remove
            currentModes = currentModes.filter(m => m !== modeToToggle);
        } else {
            // Add
            currentModes.push(modeToToggle);
        }

        // Ensure at least 'button' is there if empty
        if (currentModes.length === 0) {
            currentModes.push('button');
        }

        await updateGuildConfig(ctx.chat.id, { captcha_mode: currentModes.join(',') });
        await ui.sendCaptchaModeMenu(ctx);
        return;
    }

    // Cycle Timeout
    if (data.startsWith('wc_cycle:timeout:')) {
        const current = parseInt(data.split(':')[2]);
        const steps = [1, 3, 5, 10, 15, 30, 60];
        let idx = steps.indexOf(current);
        if (idx === -1) idx = 2; // Default 5
        const next = steps[(idx + 1) % steps.length];
        await updateGuildConfig(ctx.chat.id, { kick_timeout: next });
        await ui.sendWelcomeMenu(ctx, true);
        return;
    }

    // Cycle AutoDelete (minutes: 0=Off, 1, 3, 5, 10)
    if (data.startsWith('wc_cycle:autodelete:')) {
        const current = parseInt(data.split(':')[2]);
        const steps = [0, 1, 3, 5, 10]; // 0=Off, 1m, 3m, 5m, 10m
        let idx = steps.indexOf(current);
        if (idx === -1) idx = 0;
        const next = steps[(idx + 1) % steps.length];
        await updateGuildConfig(ctx.chat.id, { welcome_autodelete_timer: next });
        await ui.sendWelcomeMenu(ctx, true);
        return;
    }

    // Actions
    if (data === 'wc_set_msg') {
        const msgId = ctx.callbackQuery.message.message_id;
        wizard.startSession(ctx.from.id, ctx.chat.id, msgId, 'set_welcome_msg');
        await ui.sendWizardPrompt(ctx);
        return;
    }

    if (data === 'wc_set_rules') {
        const msgId = ctx.callbackQuery.message.message_id;
        wizard.startSession(ctx.from.id, ctx.chat.id, msgId, 'set_rules_link');
        await ui.sendRulesWizardPrompt(ctx);
        return;
    }

    if (data === 'wc_cancel_wizard') {
        wizard.stopSession(ctx.from.id, ctx.chat.id);
        await ui.sendWelcomeMenu(ctx, true);
        return;
    }

    if (data === 'wc_del_msg') {
        await updateGuildConfig(ctx.chat.id, {
            welcome_message: null,
            welcome_buttons: null,
            welcome_msg_enabled: 0
        });
        await ctx.answerCallbackQuery('✅ Messaggio rimosso.');
        await ui.sendWelcomeMenu(ctx, true);
        return;
    }
}

module.exports = {
    handleCallback
};
