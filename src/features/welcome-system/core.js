/**
 * @fileoverview Logica core del sistema Welcome - Captcha e gestione membri
 * @module features/welcome-system/core
 *
 * @description
 * Gestisce tutto il flusso di verifica dei nuovi membri:
 *
 * **Flusso standard:**
 * 1. Nuovo membro entra nel gruppo
 * 2. Se captcha abilitato → restringe l'utente e mostra challenge
 * 3. L'utente risolve il captcha (varie modalità)
 * 4. Se regolamento abilitato → mostra pulsante accettazione
 * 5. Utente viene sbloccato e riceve messaggio di benvenuto
 *
 * **Modalità Captcha disponibili:**
 * - `button` - Semplice click su pulsante
 * - `math` - Risolvere operazione matematica (+, -, *)
 * - `emoji` - Selezionare emoji corrispondente al nome
 * - `color` - Selezionare colore corrispondente
 * - `reverse` - Trovare parola invertita
 * - `logic` - Completare sequenza logica/numerica
 * - `char` - Contare occorrenze di una lettera
 *
 * **Timeout:**
 * Se l'utente non completa il captcha entro il tempo limite,
 * viene kickato (ban + unban immediato).
 *
 * @requires grammy
 * @requires ../../database/repos/guild
 * @requires ./utils
 * @requires ../super-admin
 */

const { getGuildConfig } = require('../../database/repos/guild');
const logger = require('../../middlewares/logger');
const { replaceWildcards, parseButtonConfig } = require('./utils');
const { InlineKeyboard } = require('grammy');
const i18n = require('../../i18n');
const superAdmin = require('../super-admin');

/**
 * Mappa dei captcha in attesa.
 * Chiave: `userId:chatId`
 * Valore: `{ timeoutHandle, messageId }`
 * @type {Map<string, {timeoutHandle: NodeJS.Timeout, messageId: number}>}
 * @private
 */
const PENDING_CAPTCHAS = new Map();

// --- DATA LISTS ---

const EMOJI_LIST = [
    { name: 'MELA', emoji: '🍎' },
    { name: 'AUTO', emoji: '🚗' },
    { name: 'STELLA', emoji: '⭐' },
    { name: 'GATTO', emoji: '🐱' },
    { name: 'CANE', emoji: '🐶' },
    { name: 'ALLIEN', emoji: '👽' },
    { name: 'FANTASMA', emoji: '👻' },
    { name: 'PIZZA', emoji: '🍕' },
    { name: 'PALLONE', emoji: '⚽' },
    { name: 'LIBRO', emoji: '📕' },
    { name: 'TELEFONO', emoji: '📱' },
    { name: 'REGALO', emoji: '🎁' },
    { name: 'OCCHIALI', emoji: '👓' },
    { name: 'CAPPELLO', emoji: '🎩' },
    { name: 'ALBERO', emoji: '🌲' },
    { name: 'SOLE', emoji: '☀️' }
];

const COLOR_LIST = [
    { name: 'ROSSO', emoji: '🔴' },
    { name: 'BLU', emoji: '🔵' },
    { name: 'VERDE', emoji: '🟢' },
    { name: 'GIALLO', emoji: '🟡' },
    { name: 'NERO', emoji: '⚫' },
    { name: 'BIANCO', emoji: '⚪' },
    { name: 'ARANCIONE', emoji: '🟠' },
    { name: 'VIOLA', emoji: '🟣' }
];

const REVERSE_WORDS = [
    'ROMA',
    'CASA',
    'ALBERO',
    'MARE',
    'SOLE',
    'LUNA',
    'TRENO',
    'PORTA',
    'FIORE',
    'VIDEO',
    'MURO',
    'FOGLIA',
    'ACQUA',
    'FUOCO',
    'VENTO',
    'AMICO',
    'SCUOLA',
    'NOTTE',
    'GIORNO',
    'TEMPO'
];

const LOGIC_SEQUENCES = [
    { seq: '2, 4, 6, ?', ans: '8' },
    { seq: '1, 2, 3, ?', ans: '4' },
    { seq: '10, 20, 30, ?', ans: '40' },
    { seq: 'A, B, C, ?', ans: 'D' },
    { seq: '5, 10, 15, ?', ans: '20' },
    { seq: '3, 2, 1, ?', ans: '0' },
    { seq: '1, 1, 2, 3, 5, ?', ans: '8' },
    { seq: '2, 4, 8, ?', ans: '16' },
    { seq: 'O, P, Q, ?', ans: 'R' }
];

const WORD_LIST = [
    'BANANA',
    'MONTAGNA',
    'TELEGRAM',
    'ROBOT',
    'ALBERO',
    'FIUME',
    'CHITARRA',
    'TAVOLO',
    'SABBIA',
    'CASTELLO',
    'GATTO',
    'CANE',
    'SOLE',
    'LUNA',
    'STELLE',
    'MARE',
    'NONNA',
    'PIZZA',
    'PASTA',
    'ITALIA',
    'AMICO',
    'SCUOLA',
    'LIBRO',
    'COMPUTER',
    'MUSICA',
    'GIOCO',
    'FUOCO',
    'ACQUA',
    'TERRA',
    'ARIA'
];

// --- HELPER FUNCTIONS ---

/**
 * Mescola un array in ordine casuale (Fisher-Yates semplificato).
 * @param {Array} array - Array da mescolare
 * @returns {Array} Array mescolato
 * @private
 */
function shuffle(array) {
    return array.sort(() => Math.random() - 0.5);
}

/**
 * Genera un intero casuale in un range inclusivo.
 * @param {number} min - Valore minimo
 * @param {number} max - Valore massimo
 * @returns {number} Intero casuale tra min e max
 * @private
 */
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Invia un evento di log al canale configurato.
 * Supporta logging granulare per tipo di evento.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @param {'JOIN'|'SUCCESS'|'TIMEOUT'|'FAIL'} type - Tipo di evento
 * @param {Object|null} details - Dettagli aggiuntivi
 * @param {Object} config - Configurazione del gruppo
 * @param {Object|null} [userOverride=null] - Utente da usare invece di ctx.from
 * @returns {Promise<void>}
 * @private
 */
async function logWelcomeEvent(ctx, type, details, config, userOverride = null) {
    const logChannelId = config.log_channel_id;
    if (!logChannelId) return;

    // Parse log_events to check granular flags
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

    // Check if this specific event type should be logged
    const keyMap = {
        JOIN: 'welcome_join',
        SUCCESS: 'welcome_captcha_pass',
        TIMEOUT: 'welcome_captcha_timeout'
    };

    const logKey = keyMap[type];
    if (!logKey || !logEvents[logKey]) return;

    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    // Safely determine user: explicit override > details.user > ctx.from
    const user = userOverride || (details && details.user) || ctx.from;
    const chat = ctx.chat;
    let text = '';

    if (type === 'JOIN') {
        text = t('welcome.logs.new_user', {
            name: user.first_name,
            userId: user.id,
            groupName: chat.title,
            groupId: chat.id
        });
    } else if (type === 'SUCCESS') {
        text = t('welcome.logs.captcha_solved', {
            name: user.first_name,
            userId: user.id,
            groupName: chat.title,
            groupId: chat.id
        });
    } else if (type === 'TIMEOUT') {
        text = t('welcome.logs.captcha_timeout', {
            name: user.first_name,
            userId: user.id,
            groupName: chat.title,
            groupId: chat.id
        });
    }

    try {
        await ctx.api.sendMessage(logChannelId, text, { parse_mode: 'HTML' });
    } catch (e) {
        logger.error(`[Welcome] Failed to send log: ${e.message}`);
    }
}

/**
 * Gestisce l'ingresso di nuovi membri nel gruppo.
 * Determina se attivare il captcha o inviare direttamente il benvenuto.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @returns {Promise<void>}
 */
async function handleNewMember(ctx) {
    let newMembers = [];
    let isJoin = false;

    // Check if it's a message event (add/join)
    if (ctx.message && ctx.message.new_chat_members) {
        logger.debug(`[Welcome] Received message:new_chat_members update.`);
        newMembers = ctx.message.new_chat_members;
        isJoin = true;
    }
    // Check if it's a chat_member update (status change)
    else if (ctx.chatMember) {
        const status = ctx.chatMember.new_chat_member.status;
        const oldStatus = ctx.chatMember.old_chat_member.status;

        logger.debug(
            `[Welcome] Member update: ${ctx.from.id} (${ctx.from.first_name}) - Old: ${oldStatus}, New: ${status}`
        );

        // Only trigger on join (member/restricted) from non-member
        isJoin = (status === 'member' || status === 'restricted') && (oldStatus === 'left' || oldStatus === 'kicked');

        if (isJoin) {
            newMembers = [ctx.chatMember.new_chat_member.user];
        }
    }

    if (!isJoin || newMembers.length === 0) {
        if (!ctx.message?.new_chat_members) {
            // Don't log ignore for every message if possible, but here we are in handler
            logger.debug(`[Welcome] Not a join event. Ignoring.`);
        }
        return;
    }

    // Filter bots
    const humans = newMembers.filter(m => !m.is_bot);
    if (humans.length === 0) {
        logger.debug(`[Welcome] Only bots joined. Ignoring.`);
        return;
    }

    const config = await getGuildConfig(ctx.chat.id);
    const captchaEnabled = config.captcha_enabled === true || config.captcha_enabled === 1; // Correct toggle check
    logger.debug(`[Welcome] Captcha Enabled: ${captchaEnabled} (Value: ${config.captcha_enabled})`);

    for (const member of humans) {
        await processUserJoin(ctx, member, config);
    }
}

/**
 * Elabora l'ingresso di un singolo utente.
 * Restringe l'utente, genera il captcha appropriato e imposta il timeout.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @param {Object} user - Oggetto utente Telegram
 * @param {Object} config - Configurazione del gruppo
 * @returns {Promise<void>}
 * @private
 */
async function processUserJoin(ctx, user, config) {
    logWelcomeEvent(ctx, 'JOIN', null, config, user);

    // Log join to global log (Parliament will receive it in join_logs topic)
    if (superAdmin.sendGlobalLog) {
        await superAdmin.sendGlobalLog({
            eventType: 'user_join',
            guildId: ctx.chat.id,
            executor: 'System',
            target: `${user.first_name} [${user.id}]`,
            reason: 'New member joined',
            details: ctx.chat.title
        });
    }

    const captchaEnabled = config.captcha_enabled === true || config.captcha_enabled === 1;

    if (!captchaEnabled) {
        await sendWelcome(ctx, config, user);
        return;
    }

    logger.info(`[Welcome] New member ${user.id} in ${ctx.chat.id}. Sending Captcha.`);

    // 1. Restrict User
    try {
        logger.debug(`[Welcome] Attempting to restrict user ${user.id}...`);
        await ctx.restrictChatMember(user.id, {
            can_send_messages: false,
            can_send_media_messages: false,
            can_send_other_messages: false,
            can_add_web_page_previews: false
        });
        logger.debug(`[Welcome] User ${user.id} restricted successfully.`);
    } catch (e) {
        logger.error(`[Welcome] Failed to restrict ${user.id}: ${e.message}`);
    }

    // 2. Prepare Captcha
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);
    const mode = config.captcha_mode || 'button';
    const timeoutMins = config.captcha_timeout || 5;
    let text = '';
    const keyboard = new InlineKeyboard();

    try {
        if (mode === 'math') {
            const ops = ['+', '-', '*'];
            const op = ops[Math.floor(Math.random() * ops.length)];
            let a, b, ans;

            if (op === '*') {
                a = getRandomInt(2, 6);
                b = getRandomInt(2, 6);
                ans = a * b;
            } else if (op === '-') {
                a = getRandomInt(5, 14);
                b = getRandomInt(1, a);
                ans = a - b;
            } else {
                a = getRandomInt(1, 10);
                b = getRandomInt(1, 10);
                ans = a + b;
            }

            text = `${t('welcome.captcha_messages.welcome', { name: user.first_name })}\n${t('welcome.captcha_messages.solve_captcha')}\n\n${t('welcome.captcha_messages.math_question', { a, op: op === '*' ? 'x' : op, b })}\n\n${t('welcome.captcha_messages.timeout', { minutes: timeoutMins })}`;

            const options = new Set([ans]);
            while (options.size < 4) {
                let fake;
                if (op === '*') fake = ans + getRandomInt(1, 6) * (Math.random() < 0.5 ? -1 : 1);
                else fake = ans + getRandomInt(1, 5) * (Math.random() < 0.5 ? -1 : 1);
                if (fake >= 0) options.add(fake);
            }
            generateButtons(keyboard, user.id, ans, Array.from(options));
        } else if (mode === 'char') {
            const word = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
            const char = word.charAt(Math.floor(Math.random() * word.length));
            const ans = word.split(char).length - 1;

            text = `${t('welcome.captcha_messages.welcome', { name: user.first_name })}\n${t('welcome.captcha_messages.complete_verification')}\n\n${t('welcome.captcha_messages.char_question', { char, word })}\n\n${t('welcome.captcha_messages.timeout', { minutes: timeoutMins })}`;

            const options = new Set([ans]);
            while (options.size < 4) {
                const fake = getRandomInt(1, 5);
                if (fake !== ans) options.add(fake);
            }
            generateButtons(keyboard, user.id, ans, Array.from(options));
        } else if (mode === 'emoji') {
            const correctItem = EMOJI_LIST[Math.floor(Math.random() * EMOJI_LIST.length)];
            const ans = correctItem.emoji;
            text = `${t('welcome.captcha_messages.welcome', { name: user.first_name })}\n${t('welcome.captcha_messages.click_emoji')}\n\n${t('welcome.captcha_messages.emoji_question', { emoji: correctItem.name })}\n\n${t('welcome.captcha_messages.timeout', { minutes: timeoutMins })}`;

            const options = new Set([ans]);
            while (options.size < 4) {
                const fake = EMOJI_LIST[Math.floor(Math.random() * EMOJI_LIST.length)].emoji;
                if (fake !== ans) options.add(fake);
            }
            generateButtons(keyboard, user.id, ans, Array.from(options));
        } else if (mode === 'color') {
            const correctItem = COLOR_LIST[Math.floor(Math.random() * COLOR_LIST.length)];
            const ans = correctItem.emoji;
            text = `${t('welcome.captcha_messages.welcome', { name: user.first_name })}\n${t('welcome.captcha_messages.select_color')}\n\n${t('welcome.captcha_messages.color_question', { color: correctItem.name })}\n\n${t('welcome.captcha_messages.timeout', { minutes: timeoutMins })}`;

            const options = new Set([ans]);
            while (options.size < 4) {
                const fake = COLOR_LIST[Math.floor(Math.random() * COLOR_LIST.length)].emoji;
                if (fake !== ans) options.add(fake);
            }
            generateButtons(keyboard, user.id, ans, Array.from(options));
        } else if (mode === 'reverse') {
            const word = REVERSE_WORDS[Math.floor(Math.random() * REVERSE_WORDS.length)];
            const ans = word.split('').reverse().join('');
            text = `${t('welcome.captcha_messages.welcome', { name: user.first_name })}\n${t('welcome.captcha_messages.show_attention')}\n\n${t('welcome.captcha_messages.reverse_question', { word })}\n\n${t('welcome.captcha_messages.timeout', { minutes: timeoutMins })}`;

            const options = new Set([ans]);
            while (options.size < 4) {
                const otherWord = REVERSE_WORDS[Math.floor(Math.random() * REVERSE_WORDS.length)];
                const fake = otherWord.split('').reverse().join('');
                if (fake !== ans) options.add(fake);
            }
            generateButtons(keyboard, user.id, ans, Array.from(options));
        } else if (mode === 'logic') {
            const puzzle = LOGIC_SEQUENCES[Math.floor(Math.random() * LOGIC_SEQUENCES.length)];
            const ans = puzzle.ans;
            text = `${t('welcome.captcha_messages.welcome', { name: user.first_name })}\n${t('welcome.captcha_messages.complete_sequence')}\n\n${t('welcome.captcha_messages.logic_question', { sequence: puzzle.seq })}\n\n${t('welcome.captcha_messages.timeout', { minutes: timeoutMins })}`;

            const options = new Set([ans]);
            const isNum = !isNaN(ans);
            while (options.size < 4) {
                let fake;
                if (isNum) {
                    const ansNum = parseInt(ans);
                    fake = (ansNum + getRandomInt(-5, 5)).toString();
                } else {
                    const code = ans.charCodeAt(0);
                    fake = String.fromCharCode(code + getRandomInt(-3, 3));
                }
                if (fake !== ans && (isNum ? parseInt(fake) >= 0 : true)) options.add(fake);
            }
            generateButtons(keyboard, user.id, ans, Array.from(options));
        } else {
            // Button mode (Default)
            text = `${t('welcome.captcha_messages.welcome', { name: user.first_name })}\n${t('welcome.captcha_messages.confirm_human')}\n\n${t('welcome.captcha_messages.timeout', { minutes: timeoutMins })}`;
            keyboard.text('✅ Non sono un robot', `wc:b:${user.id}`);
        }

        const msg = await ctx.reply(text, {
            reply_markup: keyboard,
            parse_mode: 'HTML'
        });

        // SET TIMEOUT
        const ms = timeoutMins * 60 * 1000;
        const key = `${user.id}:${ctx.chat.id}`;
        if (PENDING_CAPTCHAS.has(key)) {
            clearTimeout(PENDING_CAPTCHAS.get(key).timeoutHandle);
            PENDING_CAPTCHAS.delete(key);
        }

        const timeoutHandle = setTimeout(async () => {
            logger.info(`[Welcome] Kicking ${user.id} for timeout.`);
            logWelcomeEvent(ctx, 'TIMEOUT', { timeout: timeoutMins }, config, user); // Pass user object
            try {
                // Kick = Ban + Unban
                // We add a small delay to ensure Telegram processes the state change correctly
                await ctx.banChatMember(user.id);
                await new Promise(resolve => setTimeout(resolve, 1000));
                await ctx.unbanChatMember(user.id);

                logger.debug(`[Welcome] User ${user.id} kicked (banned+unbanned) for timeout.`);

                await ctx.api.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});

                // Send temporary kick notification
                const kickText = t('welcome.captcha_messages.fail_message', {
                    name: user.first_name,
                    minutes: timeoutMins
                });
                const kickMsg = await ctx.reply(kickText, { parse_mode: 'HTML' });

                // Auto-delete kick notification
                setTimeout(() => {
                    ctx.api.deleteMessage(ctx.chat.id, kickMsg.message_id).catch(() => {});
                }, 10000); // 10 seconds
            } catch (e) {
                logger.error(`[Welcome] Kick failed: ${e.message}`);
            }
            PENDING_CAPTCHAS.delete(key);
        }, ms);

        PENDING_CAPTCHAS.set(key, { timeoutHandle, messageId: msg.message_id });
    } catch (e) {
        logger.error(`[Welcome] Failed to send captcha: ${e.message}`);
    }
}

/**
 * Genera i pulsanti per il captcha.
 * Dispone le opzioni in una griglia 2x2 mescolata.
 *
 * @param {import('grammy').InlineKeyboard} keyboard - Tastiera inline grammY
 * @param {number} userId - ID dell'utente target
 * @param {string|number} ans - Risposta corretta
 * @param {Array} options - Array di opzioni (4 elementi)
 * @private
 */
function generateButtons(keyboard, userId, ans, options) {
    const shuffled = shuffle(options);
    shuffled.forEach((opt, i) => {
        keyboard.text(opt.toString(), `wc:x:${userId}:${ans}:${opt}`);
        if (i === 1) keyboard.row();
    });
}

/**
 * Gestisce i callback dei captcha (risposte utente).
 * Verifica la risposta e procede con regolamento o sblocco.
 *
 * Formati callback supportati:
 * - `wc:b:USERID` - Bottone semplice
 * - `wc:x:USERID:ANS:CLICKED` - Risposta a scelta multipla
 * - `wc:accept_rules:USERID` - Accettazione regolamento
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @returns {Promise<void>}
 */
async function handleCaptchaCallback(ctx) {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith('wc:')) return;
    if (data.startsWith('wc_')) return;

    if (data.startsWith('wc:accept_rules:')) {
        // Rules acceptance
        // wc:accept_rules:USERID
        const targetUserId = parseInt(data.split(':')[2]);
        if (ctx.from.id !== targetUserId) return ctx.answerCallbackQuery('Non per te.');

        await completeVerification(ctx, targetUserId);
        return;
    }

    const parts = data.split(':');
    // wc:MODE:USERID[:ANS:CLICKED]
    const mode = parts[1]; // 'b' or 'x'
    const targetUserId = parseInt(parts[2]);

    if (ctx.from.id !== targetUserId) {
        return ctx.answerCallbackQuery({
            text: '⚠️ Questo captcha non è per te!',
            show_alert: true
        });
    }

    let success = false;
    const config = await getGuildConfig(ctx.chat.id);

    if (mode === 'b') {
        success = true;
    } else {
        const correct = parts[3];
        const clicked = parts[4];
        if (correct === clicked) {
            success = true;
        } else {
            logWelcomeEvent(ctx, 'FAIL', null, config);
            return ctx.answerCallbackQuery({
                text: '❌ Risposta errata. Riprova.',
                show_alert: true
            });
        }
    }

    if (success) {
        const key = `${ctx.from.id}:${ctx.chat.id}`;
        if (PENDING_CAPTCHAS.has(key)) {
            clearTimeout(PENDING_CAPTCHAS.get(key).timeoutHandle);
            PENDING_CAPTCHAS.delete(key);
        }

        // Check Rules - only show if rules_enabled AND rules_link is set
        const rulesEnabled = config.rules_enabled === true || config.rules_enabled === 1;
        if (rulesEnabled && config.rules_link) {
            const guildId = ctx.chat.id;
            const lang = await i18n.getLanguage(guildId);
            const t = (key, params) => i18n.t(lang, key, params);
            const rulesLink = config.rules_link;
            const text = `${t('welcome.rules_message.title')}\n\n${t('welcome.rules_message.instruction')}`;
            try {
                await ctx.editMessageText(text, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔗 Leggi Regolamento', url: rulesLink }],
                            [{ text: '✅ Ho Letto e Accetto', callback_data: `wc:accept_rules:${ctx.from.id}` }]
                        ]
                    }
                });
            } catch (e) {
                // If edit fails, try sending new
                await ctx.deleteMessage().catch(() => {});
                await ctx.reply(text, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔗 Leggi Regolamento', url: rulesLink }],
                            [{ text: '✅ Ho Letto e Accetto', callback_data: `wc:accept_rules:${ctx.from.id}` }]
                        ]
                    }
                });
            }
            return;
        }

        await completeVerification(ctx, ctx.from.id);
    }
}

/**
 * Completa la verifica dell'utente.
 * Sblocca i permessi e invia il messaggio di benvenuto personalizzato.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @param {number} userId - ID dell'utente da sbloccare
 * @returns {Promise<void>}
 * @private
 */
async function completeVerification(ctx, userId) {
    const config = await getGuildConfig(ctx.chat.id);
    logWelcomeEvent(ctx, 'SUCCESS', null, config);

    try {
        await ctx.restrictChatMember(userId, {
            can_send_messages: true,
            can_send_media_messages: true,
            can_send_other_messages: true,
            can_add_web_page_previews: true,
            can_invite_users: true,
            can_pin_messages: false,
            can_change_info: false
        });
    } catch (e) {
        logger.error(`[Welcome] Unrestrict failed: ${e.message}`);
    }

    // If welcome message is enabled, try to edit the existing message
    if (config.welcome_msg_enabled && config.welcome_message) {
        await sendWelcome(ctx, config, null, ctx.callbackQuery?.message?.message_id);
    } else {
        // If welcome message is disabled, simply delete the captcha/rules message
        if (ctx.callbackQuery?.message?.message_id) {
            try {
                await ctx.api.deleteMessage(ctx.chat.id, ctx.callbackQuery.message.message_id);
            } catch (e) {
                logger.debug(`[Welcome] Failed to delete captcha message: ${e.message}`);
            }
        }
    }
}

/**
 * Invia il messaggio di benvenuto personalizzato.
 * Supporta wildcards, pulsanti e auto-eliminazione.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @param {Object} config - Configurazione del gruppo
 * @param {Object|null} [userOverride=null] - Utente da usare invece di ctx.from
 * @param {number|null} [messageToEditId=null] - ID messaggio da modificare (per transizione da captcha)
 * @returns {Promise<void>}
 * @private
 */
async function sendWelcome(ctx, config, userOverride = null, messageToEditId = null) {
    if (!config.welcome_msg_enabled) return;
    if (!config.welcome_message) return;

    const user = userOverride || ctx.from;
    const welcomeText = replaceWildcards(config.welcome_message, user, ctx.chat);
    const finalText = welcomeText.replace(/<br>/g, '\n');
    const buttons = parseButtonConfig(config.welcome_buttons);
    const markup = buttons.length ? { inline_keyboard: buttons } : undefined;

    let sentMessageId;

    logger.debug(`[Welcome] sendWelcome called. messageToEditId: ${messageToEditId}`);

    try {
        if (messageToEditId) {
            try {
                // Try to edit existing message
                logger.debug(`[Welcome] Attempting to edit message ${messageToEditId}`);
                const edited = await ctx.api.editMessageText(ctx.chat.id, messageToEditId, finalText, {
                    parse_mode: 'HTML',
                    reply_markup: markup,
                    link_preview_options: { is_disabled: true }
                });
                sentMessageId = edited.message_id;
                logger.debug(`[Welcome] Message edited successfully`);
            } catch (e) {
                // If edit fails (e.g. content type mismatch), delete and send new
                logger.debug(`[Welcome] Edit failed: ${e.message}. Deleting and sending new.`);
                await ctx.api.deleteMessage(ctx.chat.id, messageToEditId).catch(() => {});
                const sent = await ctx.reply(finalText, {
                    parse_mode: 'HTML',
                    reply_markup: markup,
                    link_preview_options: { is_disabled: true }
                });
                sentMessageId = sent.message_id;
            }
        } else {
            // Send new message
            logger.debug(`[Welcome] No messageToEditId, sending new message`);
            const sent = await ctx.reply(finalText, {
                parse_mode: 'HTML',
                reply_markup: markup,
                link_preview_options: { is_disabled: true }
            });
            sentMessageId = sent.message_id;
        }

        // Auto-delete (timer is in minutes)
        if (config.welcome_autodelete_timer && config.welcome_autodelete_timer > 0 && sentMessageId) {
            setTimeout(() => {
                ctx.api.deleteMessage(ctx.chat.id, sentMessageId).catch(() => {});
            }, config.welcome_autodelete_timer * 60000); // minutes to ms
        }
    } catch (e) {
        logger.error(`[Welcome] Send custom welcome failed: ${e.message}`);
        // Fallback for parsing errors... might be complex to handle with edit vs reply.
        // Simplest is to just log error if it fails after the fallback above.
    }
}

/**
 * Gestisce l'uscita di un membro dal gruppo.
 * Se l'utente aveva un captcha in sospeso, lo cancella e elimina il messaggio.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @returns {Promise<void>}
 */
async function handleMemberLeft(ctx) {
    if (!ctx.chatMember) return;

    const newStatus = ctx.chatMember.new_chat_member.status;
    const oldStatus = ctx.chatMember.old_chat_member.status;

    // Only trigger on leave (left/kicked from member/restricted)
    const isLeave =
        (newStatus === 'left' || newStatus === 'kicked') && (oldStatus === 'member' || oldStatus === 'restricted');

    if (!isLeave) return;

    const user = ctx.chatMember.new_chat_member.user;
    const key = `${user.id}:${ctx.chat.id}`;

    if (PENDING_CAPTCHAS.has(key)) {
        const pending = PENDING_CAPTCHAS.get(key);

        // Clear the timeout
        clearTimeout(pending.timeoutHandle);

        // Delete the captcha message
        try {
            await ctx.api.deleteMessage(ctx.chat.id, pending.messageId);
            logger.info(`[Welcome] Deleted pending captcha for user ${user.id} who left the group.`);
        } catch (e) {
            logger.debug(`[Welcome] Failed to delete captcha message for leaving user: ${e.message}`);
        }

        PENDING_CAPTCHAS.delete(key);
    }
}

module.exports = {
    handleNewMember,
    handleCaptchaCallback,
    handleMemberLeft
};
