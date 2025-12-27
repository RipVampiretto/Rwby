/**
 * @fileoverview Handler callback UI per il modulo Welcome System
 * @module features/welcome-system/commands
 *
 * @description
 * Gestisce tutti i callback delle interfacce utente del modulo welcome:
 * - Navigazione tra menu (main, modes, preview, notifications)
 * - Toggle configurazione (captcha, message, rules, logs)
 * - Cicli di timeout e autodelete
 * - Avvio wizard per configurazione messaggi
 *
 * Prefissi callback supportati:
 * - `wc_goto:` - Navigazione
 * - `wc_log:` - Toggle singoli eventi di log
 * - `wc_toggle:` - Toggle on/off
 * - `wc_toggle_mode:` - Selezione modalità captcha
 * - `wc_cycle:` - Ciclo valori (timeout, autodelete)
 * - `wc_set_msg` / `wc_set_rules` - Avvio wizard
 * - `wc_del_msg` - Eliminazione messaggio
 */

const { getGuildConfig, updateGuildConfig } = require('../../database/repos/guild');
const logger = require('../../middlewares/logger');
const ui = require('./ui');
const wizard = require('./wizard');
const i18n = require('../../i18n');

/**
 * Gestisce tutti i callback UI del modulo welcome (prefisso `wc_`).
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @returns {Promise<void>}
 */
async function handleCallback(ctx) {
    const data = ctx.callbackQuery.data;

    // Log every callback received
    logger.debug(`[Welcome] UI Callback received: userId=${ctx.from.id}, chatId=${ctx.chat.id}, data=${data}`, ctx);

    // Navigation
    if (data.startsWith('wc_goto:')) {
        const target = data.split(':')[1];
        logger.info(`[Welcome] Navigation to: ${target}`, ctx);

        try {
            if (target === 'main') {
                await ui.sendWelcomeMenu(ctx, true);
            } else if (target === 'modes') {
                await ui.sendCaptchaModeMenu(ctx);
            } else if (target === 'preview') {
                await ui.sendPreview(ctx);
            } else if (target === 'notifications') {
                await ui.sendNotificationsMenu(ctx, true);
            }
            logger.debug(`[Welcome] Navigation to ${target} completed successfully`, ctx);
        } catch (e) {
            logger.error(`[Welcome] Navigation error to ${target}: ${e.message}`, ctx);
        }
        try {
            await ctx.answerCallbackQuery();
        } catch (e) {
            logger.debug(`[Welcome] Failed to answer callback query: ${e.message}`, ctx);
        }
        return;
    }

    // Log event toggle (granular notifications)
    if (data.startsWith('wc_log:')) {
        const key = data.split(':')[1]; // welcome_join, welcome_captcha_pass, etc.
        logger.info(`[Welcome] Log toggle requested: key=${key}`, ctx);

        try {
            const config = (await getGuildConfig(ctx.chat.id)) || {};
            let logEvents = {};
            if (config.log_events) {
                if (typeof config.log_events === 'string') {
                    try {
                        logEvents = JSON.parse(config.log_events);
                    } catch (e) {
                        logger.warn(`[Welcome] Failed to parse log_events JSON: ${e.message}`, ctx);
                    }
                } else if (typeof config.log_events === 'object') {
                    logEvents = config.log_events;
                }
            }

            const oldValue = logEvents[key];
            // Toggle the specific key
            logEvents[key] = !logEvents[key];
            logger.info(`[Welcome] Log event ${key} toggled: ${oldValue} -> ${logEvents[key]}`, ctx);

            await updateGuildConfig(ctx.chat.id, { log_events: logEvents });
            await ui.sendNotificationsMenu(ctx, true);
        } catch (e) {
            logger.error(`[Welcome] Log toggle error for ${key}: ${e.message}`, ctx);
        }
        try {
            await ctx.answerCallbackQuery();
        } catch (e) {
            logger.debug(`[Welcome] Failed to answer callback query: ${e.message}`, ctx);
        }
        return;
    }

    // Toggle
    if (data.startsWith('wc_toggle:')) {
        const parts = data.split(':');
        const type = parts[1]; // captcha | msg
        const val = parseInt(parts[2]); // 0 | 1

        logger.info(`[Welcome] Toggle: type=${type}, newVal=${val}, chat=${ctx.chat.id}`, ctx);

        try {
            if (type === 'captcha') {
                await updateGuildConfig(ctx.chat.id, { captcha_enabled: val });
                logger.debug(`[Welcome] Captcha enabled set to ${val}`, ctx);
            } else if (type === 'msg') {
                await updateGuildConfig(ctx.chat.id, { welcome_msg_enabled: val });
                logger.debug(`[Welcome] Welcome message enabled set to ${val}`, ctx);
            } else if (type === 'rules') {
                await updateGuildConfig(ctx.chat.id, { rules_enabled: val });
                logger.debug(`[Welcome] Rules enabled set to ${val}`, ctx);
            } else if (type === 'logs') {
                await updateGuildConfig(ctx.chat.id, { captcha_logs_enabled: val });
                logger.debug(`[Welcome] Captcha logs enabled set to ${val}`, ctx);
            }
            logger.info(`[Welcome] Toggle ${type} update complete, refreshing UI`, ctx);
            await ui.sendWelcomeMenu(ctx, true);
        } catch (e) {
            logger.error(`[Welcome] Toggle error for ${type}: ${e.message}`, ctx);
            console.error(e);
        }
        try {
            await ctx.answerCallbackQuery();
        } catch (e) {
            logger.debug(`[Welcome] Failed to answer callback query: ${e.message}`, ctx);
        }
        return;
    }

    // Toggle Mode (Multi-select)
    if (data.startsWith('wc_toggle_mode:')) {
        const modeToToggle = data.split(':')[1];
        logger.info(`[Welcome] Mode toggle requested: mode=${modeToToggle}`, ctx);

        const config = await getGuildConfig(ctx.chat.id);
        let currentModes = (config.captcha_mode || 'button').split(',');
        const previousModes = [...currentModes];

        if (currentModes.includes(modeToToggle)) {
            // Remove
            currentModes = currentModes.filter(m => m !== modeToToggle);
            logger.debug(`[Welcome] Removed mode ${modeToToggle}`, ctx);
        } else {
            // Add
            currentModes.push(modeToToggle);
            logger.debug(`[Welcome] Added mode ${modeToToggle}`, ctx);
        }

        // Ensure at least 'button' is there if empty
        if (currentModes.length === 0) {
            currentModes.push('button');
            logger.debug(`[Welcome] Modes was empty, defaulting to button`, ctx);
        }

        logger.info(`[Welcome] Captcha modes changed: [${previousModes.join(',')}] -> [${currentModes.join(',')}]`, ctx);
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

        logger.info(`[Welcome] Timeout cycled: ${current}min -> ${next}min`, ctx);
        await updateGuildConfig(ctx.chat.id, { captcha_timeout: next });
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

        logger.info(`[Welcome] AutoDelete cycled: ${current === 0 ? 'Off' : current + 'min'} -> ${next === 0 ? 'Off' : next + 'min'}`, ctx);
        await updateGuildConfig(ctx.chat.id, { welcome_autodelete_timer: next });
        await ui.sendWelcomeMenu(ctx, true);
        return;
    }

    // Actions
    if (data === 'wc_set_msg') {
        logger.info(`[Welcome] Starting wizard: set_welcome_msg`, ctx);
        const msgId = ctx.callbackQuery.message.message_id;
        wizard.startSession(ctx.from.id, ctx.chat.id, msgId, 'set_welcome_msg');
        await ui.sendWizardPrompt(ctx);
        return;
    }

    if (data === 'wc_set_rules') {
        logger.info(`[Welcome] Starting wizard: set_rules_link`, ctx);
        const msgId = ctx.callbackQuery.message.message_id;
        wizard.startSession(ctx.from.id, ctx.chat.id, msgId, 'set_rules_link');
        await ui.sendRulesWizardPrompt(ctx);
        return;
    }

    if (data === 'wc_cancel_wizard') {
        logger.info(`[Welcome] Wizard cancelled by user`, ctx);
        wizard.stopSession(ctx.from.id, ctx.chat.id);
        await ui.sendWelcomeMenu(ctx, true);
        return;
    }

    if (data === 'wc_del_msg') {
        logger.info(`[Welcome] Deleting welcome message configuration`, ctx);
        await updateGuildConfig(ctx.chat.id, {
            welcome_message: null,
            welcome_buttons: null,
            welcome_msg_enabled: 0
        });
        const lang = await i18n.getLanguage(ctx.chat.id);
        await ctx.answerCallbackQuery(i18n.t(lang, 'welcome.wizard.message_removed'));
        await ui.sendWelcomeMenu(ctx, true);
        logger.debug(`[Welcome] Welcome message deleted successfully`, ctx);
        return;
    }

    // Unknown callback
    logger.debug(`[Welcome] Unknown wc_ callback received: ${data}`, ctx);
}


module.exports = {
    handleCallback
};
