/**
 * @fileoverview Interfacce utente per il modulo Welcome System
 * @module features/welcome-system/ui
 *
 * @description
 * Gestisce tutte le interfacce inline per la configurazione del sistema welcome:
 * - Menu principale con tutti i toggle e opzioni
 * - Sottomenu selezione modalità captcha
 * - Anteprima messaggio di benvenuto
 * - Prompt wizard per configurazione
 * - Menu notifiche granulari
 *
 * @requires ../../database/repos/guild - Per lettura configurazione
 * @requires ../../i18n - Per traduzioni
 * @requires ./utils - Per parsing wildcards e pulsanti
 */

const { fetchGuildConfig: getGuildConfig } = require('../../database/repos/guild');
const i18n = require('../../i18n');
const { replaceWildcards, parseButtonConfig } = require('./utils');
const logger = require('../../middlewares/logger');

/**
 * Mostra il menu principale del sistema Welcome.
 * Include toggle per captcha, messaggio, timeout, regolamento, ecc.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @param {boolean} [isEdit=false] - Se true, modifica il messaggio esistente
 * @returns {Promise<void>}
 */
async function sendWelcomeMenu(ctx, isEdit = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);
    const config = (await getGuildConfig(guildId)) || {};

    const captchaEnabled = config.captcha_enabled === true || config.captcha_enabled === 1;
    const msgEnabled = config.welcome_msg_enabled === true || config.welcome_msg_enabled === 1;
    const modes = (config.captcha_mode || 'button').split(',');
    const modeDisplay = modes.length > 1 ? t('welcome.modes_active', { count: modes.length }) : modes[0];
    const timeout = config.captcha_timeout || 5;
    const autoDelete = config.welcome_autodelete_timer || 0;
    const rulesEnabled = config.rules_enabled === true || config.rules_enabled === 1;

    const onOff = enabled => (enabled ? t('common.on') : t('common.off'));
    const onOffLabel = enabled => (enabled ? 'ON' : 'OFF');

    // Build text
    let text = t('welcome.title') + '\n\n';
    text += `${t('welcome.captcha')} ${onOff(captchaEnabled)}\n`;
    text += `${t('welcome.welcome_msg')} ${msgEnabled ? (config.welcome_message ? t('common.on') : t('welcome.on_no_msg')) : t('common.off')}\n`;

    // Show details only when enabled
    if (captchaEnabled) {
        text += `${t('welcome.mode')} <code>${modeDisplay}</code>\n`;
        text += `${t('welcome.timeout')} <code>${t('welcome.minutes', { count: timeout })}</code>\n`;
    }

    if (msgEnabled) {
        text += `${t('welcome.autodelete')} <code>${autoDelete === 0 ? t('common.off') : t('welcome.minutes', { count: autoDelete })}</code>\n`;
        text += `${t('welcome.rules')} ${onOff(rulesEnabled)}\n`;
    }

    // Build keyboard dynamically
    const rows = [];

    // Row 1: Main toggles
    rows.push([
        {
            text: t('welcome.buttons.captcha_toggle', { status: onOffLabel(captchaEnabled) }),
            callback_data: `wc_toggle:captcha:${captchaEnabled ? 0 : 1}`
        },
        {
            text: t('welcome.buttons.msg_toggle', { status: onOffLabel(msgEnabled) }),
            callback_data: `wc_toggle:msg:${msgEnabled ? 0 : 1}`
        }
    ]);

    // Captcha options (only when enabled)
    if (captchaEnabled) {
        rows.push([{ text: t('welcome.buttons.choose_mode'), callback_data: 'wc_goto:modes' }]);
        rows.push([
            { text: t('welcome.buttons.timeout', { time: timeout }), callback_data: `wc_cycle:timeout:${timeout}` }
        ]);
    }

    // Welcome message options (only when enabled)
    if (msgEnabled) {
        rows.push([
            { text: t('welcome.buttons.set_welcome'), callback_data: 'wc_set_msg' },
            { text: t('welcome.buttons.remove_welcome'), callback_data: 'wc_del_msg' }
        ]);
        rows.push([{ text: t('welcome.buttons.preview'), callback_data: 'wc_goto:preview' }]);

        // AutoDelete for welcome message
        rows.push([
            {
                text: t('welcome.buttons.autodelete', {
                    time: autoDelete === 0 ? t('common.off') : autoDelete + 'm'
                }),
                callback_data: `wc_cycle:autodelete:${autoDelete}`
            }
        ]);

        // Rules toggle (only when welcome enabled)
        rows.push([
            {
                text: t('welcome.buttons.rules_toggle', { status: onOffLabel(rulesEnabled) }),
                callback_data: `wc_toggle:rules:${rulesEnabled ? 0 : 1}`
            }
        ]);

        // Rules link button (only when rules enabled)
        if (rulesEnabled) {
            rows.push([{ text: t('welcome.buttons.set_rules'), callback_data: 'wc_set_rules' }]);
        }
    }

    // Notifications button (always show when either enabled)
    if (captchaEnabled || msgEnabled) {
        rows.push([{ text: t('welcome.buttons.notifications'), callback_data: 'wc_goto:notifications' }]);
    }

    // Back button
    rows.push([{ text: t('common.back'), callback_data: 'settings_main' }]);

    const keyboard = { inline_keyboard: rows };

    if (isEdit) {
        try {
            await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
        } catch (e) {}
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    }
}

/**
 * Mostra il sottomenu per la selezione delle modalità captcha.
 * Supporta multi-selezione (più modalità contemporaneamente).
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @returns {Promise<void>}
 */
async function sendCaptchaModeMenu(ctx) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);
    const config = (await getGuildConfig(guildId)) || {};
    const currentModes = (config.captcha_mode || 'button').split(',');

    const isModeActive = mode => currentModes.includes(mode);
    const getMark = mode => (isModeActive(mode) ? '✅' : '');

    let text = t('welcome.modes.title') + '\n\n';
    text += t('welcome.modes.subtitle') + '\n\n';

    text += t('welcome.modes.descriptions.button') + '\n';
    text += t('welcome.modes.descriptions.math') + '\n';
    text += t('welcome.modes.descriptions.char') + '\n';
    text += t('welcome.modes.descriptions.emoji') + '\n';
    text += t('welcome.modes.descriptions.color') + '\n';
    text += t('welcome.modes.descriptions.logic') + '\n';
    text += t('welcome.modes.descriptions.reverse') + '\n\n';

    text += t('welcome.modes.active', { modes: currentModes.join(', ') });

    const keyboard = {
        inline_keyboard: [
            [
                { text: `${getMark('button')} Button`, callback_data: 'wc_toggle_mode:button' },
                { text: `${getMark('math')} Math`, callback_data: 'wc_toggle_mode:math' }
            ],
            [
                { text: `${getMark('char')} Char`, callback_data: 'wc_toggle_mode:char' },
                { text: `${getMark('emoji')} Emoji`, callback_data: 'wc_toggle_mode:emoji' }
            ],
            [
                { text: `${getMark('color')} Color`, callback_data: 'wc_toggle_mode:color' },
                { text: `${getMark('logic')} Logic`, callback_data: 'wc_toggle_mode:logic' }
            ],
            [{ text: `${getMark('reverse')} Reverse`, callback_data: 'wc_toggle_mode:reverse' }],
            [{ text: t('common.back'), callback_data: 'wc_goto:main' }]
        ]
    };

    try {
        await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    } catch (e) {
        console.error('Edit Mode Menu Error:', e);
    }
    try {
        await ctx.answerCallbackQuery();
    } catch (e) {}
}

/**
 * Mostra l'anteprima del messaggio di benvenuto.
 * Applica le wildcards con i dati dell'utente corrente.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @returns {Promise<void>}
 */
async function sendPreview(ctx) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);
    const config = await getGuildConfig(guildId);
    if (!config.welcome_message) {
        return ctx.answerCallbackQuery(t('welcome.preview.no_message'));
    }

    const { replaceWildcards, parseButtonConfig } = require('./utils');
    const welcomeText = replaceWildcards(config.welcome_message, ctx.from, ctx.chat);
    // Fix <br> for preview
    const finalText = welcomeText.replace(/<br>/g, '\n');
    const buttons = parseButtonConfig(config.welcome_buttons);

    const previewKeyboard = [];
    if (buttons.length > 0) {
        buttons.forEach(row => previewKeyboard.push(row));
    }
    // Add Back Button
    previewKeyboard.push([{ text: t('welcome.buttons.back_to_menu'), callback_data: 'wc_goto:main' }]);

    try {
        await ctx.editMessageText(finalText, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: previewKeyboard },
            link_preview_options: { is_disabled: true }
        });
    } catch (e) {
        await ctx.answerCallbackQuery(`Errore anteprima: ${e.message}`);
    }
}

/**
 * Mostra il prompt wizard per impostare il link al regolamento.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @returns {Promise<void>}
 */
async function sendRulesWizardPrompt(ctx) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);
    const text =
        t('welcome.rules_prompt.title') +
        '\n\n' +
        t('welcome.rules_prompt.instruction') +
        '\n' +
        t('welcome.rules_prompt.usage');

    const keyboard = {
        inline_keyboard: [[{ text: t('welcome.rules_prompt.button_cancel'), callback_data: 'wc_cancel_wizard' }]]
    };

    try {
        await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    } catch (e) {
        logger.error(`[Welcome] Failed to send rules wizard prompt: ${e.message}`, ctx);
    }
}

/**
 * Mostra il prompt wizard per impostare il messaggio di benvenuto.
 * Include documentazione completa delle wildcards disponibili.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @returns {Promise<void>}
 */
async function sendWizardPrompt(ctx) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);
    const text =
        t('welcome.wizard.title') +
        '\n\n' +
        t('welcome.wizard.instruction') +
        '\n\n' +
        t('welcome.wizard.user_data') +
        '\n' +
        t('welcome.wizard.placeholders.mention') +
        '\n' +
        t('welcome.wizard.placeholders.user') +
        '\n' +
        t('welcome.wizard.placeholders.username') +
        '\n' +
        t('welcome.wizard.placeholders.first_name') +
        '\n' +
        t('welcome.wizard.placeholders.last_name') +
        '\n' +
        t('welcome.wizard.placeholders.id') +
        '\n\n' +
        t('welcome.wizard.group_data') +
        '\n' +
        t('welcome.wizard.placeholders.mention_group') +
        '\n' +
        t('welcome.wizard.placeholders.chat_title') +
        '\n' +
        t('welcome.wizard.placeholders.chat_username') +
        '\n' +
        t('welcome.wizard.placeholders.chat_id') +
        '\n\n' +
        t('welcome.wizard.special_functions') +
        '\n' +
        t('welcome.wizard.placeholders.custom_link') +
        '\n\n' +
        t('welcome.wizard.custom_buttons') +
        '\n' +
        t('welcome.wizard.buttons_format') +
        '\n' +
        t('welcome.wizard.buttons_example');

    const keyboard = {
        inline_keyboard: [[{ text: t('welcome.rules_prompt.button_cancel'), callback_data: 'wc_cancel_wizard' }]]
    };

    try {
        await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    } catch (e) {
        logger.error(`[Welcome] Failed to send wizard prompt: ${e.message}`, ctx);
    }
}

/**
 * Mostra il menu delle notifiche granulari.
 * Permette di abilitare/disabilitare singoli eventi di log.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @param {boolean} [isEdit=false] - Se true, modifica il messaggio esistente
 * @returns {Promise<void>}
 */
async function sendNotificationsMenu(ctx, isEdit = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);
    const config = (await getGuildConfig(guildId)) || {};

    // Parse log_events (always Object)
    let logEvents = {};
    if (config.log_events) {
        if (typeof config.log_events === 'string') {
            try {
                logEvents = JSON.parse(config.log_events);
            } catch (e) {}
        } else if (typeof config.log_events === 'object') {
            logEvents = config.log_events;
        }
    }

    const isOn = key => (logEvents[key] ? '✅' : '❌');
    const hasLogChannel = !!config.log_channel_id;

    let text = `${t('welcome.notifications.title')}\n\n` + `${t('welcome.notifications.description')}\n\n`;

    // Add warning if no log channel
    if (!hasLogChannel) {
        text += `⚠️ <i>${t('welcome.notifications.no_log_channel')}</i>\n\n`;
    }

    text +=
        `${t('welcome.notifications.join')} ${isOn('welcome_join')}\n` +
        `${t('welcome.notifications.captcha_pass')} ${isOn('welcome_captcha_pass')}\n` +
        `${t('welcome.notifications.captcha_timeout')} ${isOn('welcome_captcha_timeout')}`;

    const keyboard = {
        inline_keyboard: [
            [
                { text: `👤 ${isOn('welcome_join')}`, callback_data: 'wc_log:welcome_join' },
                { text: `✅ ${isOn('welcome_captcha_pass')}`, callback_data: 'wc_log:welcome_captcha_pass' }
            ],
            [{ text: `⏰ ${isOn('welcome_captcha_timeout')}`, callback_data: 'wc_log:welcome_captcha_timeout' }],
            [{ text: t('common.back'), callback_data: 'wc_goto:main' }]
        ]
    };

    if (isEdit) {
        try {
            await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
        } catch (e) {}
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    }
}

module.exports = {
    sendWelcomeMenu,
    sendCaptchaModeMenu,
    sendPreview,
    sendWizardPrompt,
    sendRulesWizardPrompt,
    sendNotificationsMenu
};
