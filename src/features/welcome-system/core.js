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
const { initializeUserFlux } = require('../user-reputation/logic');
const db = require('../../database');
const dbStore = require('./db-store');

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

const recentlyLeftUsers = new Set();

/**
 * Gestisce il messaggio di servizio "User left" (message:left_chat_member).
 * Se l'utente è uscito mentre aveva un captcha (tracciato in recentlyLeftUsers),
 * eliminiamo il messaggio di servizio per pulizia.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @returns {Promise<void>}
 */
async function handleLeftMessage(ctx) {
    const userId = ctx.message.left_chat_member.id;
    const key = `${ctx.chat.id}:${userId}`;

    // Check if this user is in our "recently failed/left during captcha" list or if we just want to suppress it?
    // For now, we only suppress if they were tracked in handleMemberLeft
    if (recentlyLeftUsers.has(key)) {
        logger.debug(`[Welcome] Deleting 'User left' message ${ctx.message.message_id} for user ${userId}`);
        try {
            await ctx.deleteMessage();
            recentlyLeftUsers.delete(key);
        } catch (e) {
            logger.debug(`[Welcome] Failed to delete 'User left' message: ${e.message}`);
        }
    }
}

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
            } catch (e) { }
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
        const oldIsMember = ctx.chatMember.old_chat_member.is_member;
        const newIsMember = ctx.chatMember.new_chat_member.is_member;

        logger.debug(
            `[Welcome] Member update: ${ctx.from.id} (${ctx.from.first_name}) - Old: ${oldStatus} (isMember:${oldIsMember}), New: ${status} (isMember:${newIsMember})`
        );

        // Only trigger on join (member/restricted) from non-member
        // Standard join: left/kicked -> member/restricted
        // Re-join after restricted leave: restricted (isMember:false) -> restricted/member
        isJoin = (status === 'member' || status === 'restricted') &&
            (oldStatus === 'left' || oldStatus === 'kicked' || (oldStatus === 'restricted' && oldIsMember === false));

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
        if (ctx.message) {
            // Delete service messages if needed later
            // We just pass the ID, logic will handle if it should be saved
            await processUserJoin(ctx, member, config, ctx.message.message_id);
        } else {
            await processUserJoin(ctx, member, config);
        }
    }
}

/**
 * Elabora l'ingresso di un singolo utente.
 * Restringe l'utente, genera il captcha appropriato e imposta il timeout.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @param {Object} user - Oggetto utente Telegram
 * @param {Object} config - Configurazione del gruppo
 * @param {number|null} [serviceMessageId=null] - ID messaggio di servizio (join)
 * @returns {Promise<void>}
 * @private
 */
async function processUserJoin(ctx, user, config, serviceMessageId = null) {
    // 0. Check for existing pending captcha to avoid duplicates & double logging
    // If found, we just update the service_message_id (if available) and exit.
    try {
        const existing = await dbStore.getPendingCaptcha(ctx.chat.id, user.id);
        if (existing) {
            logger.debug(`[Welcome] Found existing pending captcha for user ${user.id}`);

            // If we have a service ID now but didn't before, update it
            if (serviceMessageId && !existing.service_message_id) {
                logger.debug(`[Welcome] Updating service_message_id for existing captcha: ${serviceMessageId}`);
                await dbStore.updatePendingServiceMessage(existing.id, serviceMessageId);
            }

            // Exit immediately, assuming chat_member event already handled the rest
            return;
        }
    } catch (e) {
        logger.error(`[Welcome] Error checking existing captcha: ${e.message}`);
    }

    // IMPORTANT: Track the user in database when they join (not just when they message)
    try {
        const db = require('../../database');
        await db.upsertUser(user);
        logger.debug(`[Welcome] Tracked new user ${user.id} (${user.first_name}) in database`);
    } catch (e) {
        logger.error(`[Welcome] Failed to track user ${user.id}: ${e.message}`);
    }

    logWelcomeEvent(ctx, 'JOIN', null, config, user);

    // Initialize user flux to 0 if not exists (track user from join moment)
    await initializeUserFlux(db, user.id, ctx.chat.id);

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
    const modes = (config.captcha_mode || 'button').split(',');
    const mode = modes[Math.floor(Math.random() * modes.length)];
    const timeoutMins = config.captcha_timeout || 5;
    let text = '';
    let ans = null; // Declare ans at function scope so it's available for all captcha modes
    const keyboard = new InlineKeyboard();

    try {
        if (mode === 'math') {
            const ops = ['+', '-', '*'];
            const op = ops[Math.floor(Math.random() * ops.length)];
            let a, b;

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
            ans = word.split(char).length - 1;

            text = `${t('welcome.captcha_messages.welcome', { name: user.first_name })}\n${t('welcome.captcha_messages.complete_verification')}\n\n${t('welcome.captcha_messages.char_question', { char, word })}\n\n${t('welcome.captcha_messages.timeout', { minutes: timeoutMins })}`;

            const options = new Set([ans]);
            while (options.size < 4) {
                const fake = getRandomInt(1, 5);
                if (fake !== ans) options.add(fake);
            }
            generateButtons(keyboard, user.id, ans, Array.from(options));
        } else if (mode === 'emoji') {
            const correctItem = EMOJI_LIST[Math.floor(Math.random() * EMOJI_LIST.length)];
            ans = correctItem.emoji;
            text = `${t('welcome.captcha_messages.welcome', { name: user.first_name })}\n${t('welcome.captcha_messages.click_emoji')}\n\n${t('welcome.captcha_messages.emoji_question', { emoji: correctItem.name })}\n\n${t('welcome.captcha_messages.timeout', { minutes: timeoutMins })}`;

            const options = new Set([ans]);
            while (options.size < 4) {
                const fake = EMOJI_LIST[Math.floor(Math.random() * EMOJI_LIST.length)].emoji;
                if (fake !== ans) options.add(fake);
            }
            generateButtons(keyboard, user.id, ans, Array.from(options));
        } else if (mode === 'color') {
            const correctItem = COLOR_LIST[Math.floor(Math.random() * COLOR_LIST.length)];
            ans = correctItem.emoji;
            text = `${t('welcome.captcha_messages.welcome', { name: user.first_name })}\n${t('welcome.captcha_messages.select_color')}\n\n${t('welcome.captcha_messages.color_question', { color: correctItem.name })}\n\n${t('welcome.captcha_messages.timeout', { minutes: timeoutMins })}`;

            const options = new Set([ans]);
            while (options.size < 4) {
                const fake = COLOR_LIST[Math.floor(Math.random() * COLOR_LIST.length)].emoji;
                if (fake !== ans) options.add(fake);
            }
            generateButtons(keyboard, user.id, ans, Array.from(options));
        } else if (mode === 'reverse') {
            const word = REVERSE_WORDS[Math.floor(Math.random() * REVERSE_WORDS.length)];
            ans = word.split('').reverse().join('');
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
            ans = puzzle.ans;
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
            ans = 'CHECK'; // Button mode doesn't need a specific answer
            text = `${t('welcome.captcha_messages.welcome', { name: user.first_name })}\n${t('welcome.captcha_messages.confirm_human')}\n\n${t('welcome.captcha_messages.timeout', { minutes: timeoutMins })}`;
            keyboard.text('✅ Non sono un robot', `wc:b:${user.id}`);
        }

        const msg = await ctx.reply(text, {
            reply_markup: keyboard,
            parse_mode: 'HTML'
        });

        // SAVE TO DB
        logger.debug(
            `[Welcome] Saving captcha: user=${user.id}, msgId=${msg.message_id}, ans=${ans}, serviceMsgId=${serviceMessageId}`
        );
        await dbStore.addPendingCaptcha(
            guildId,
            user.id,
            msg.message_id,
            ans || 'CHECK',
            timeoutMins,
            [],
            serviceMessageId
        );
        logger.debug(`[Welcome] Captcha for ${user.id} saved to DB.`);
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

    // Log every captcha callback received
    logger.debug(`[Welcome] Captcha callback received: userId=${ctx.from.id}, chatId=${ctx.chat.id}, data=${data}`, ctx);

    if (!data.startsWith('wc:')) {
        logger.debug(`[Welcome] Ignoring non-captcha callback: ${data}`, ctx);
        return;
    }
    if (data.startsWith('wc_')) {
        logger.debug(`[Welcome] Ignoring wc_ callback (UI callback): ${data}`, ctx);
        return;
    }

    if (data.startsWith('wc:accept_rules:')) {
        // Rules acceptance
        // wc:accept_rules:USERID:SERVICEMSGID
        const parts = data.split(':');
        const targetUserId = parseInt(parts[2]);
        const serviceMsgId = parts[3] && parts[3] !== '0' ? parseInt(parts[3]) : null;

        logger.debug(`[Welcome] Rules acceptance button clicked: userId=${ctx.from.id}, targetUserId=${targetUserId}`, ctx);

        if (ctx.from.id !== targetUserId) {
            logger.warn(`[Welcome] User ${ctx.from.id} tried to accept rules for user ${targetUserId} - denied`, ctx);
            return ctx.answerCallbackQuery('Non per te.');
        }

        logger.info(`[Welcome] User ${ctx.from.id} accepted rules, completing verification`, ctx);
        await completeVerificationWithServiceMsgId(ctx, targetUserId, serviceMsgId);
        return;
    }

    const parts = data.split(':');
    // wc:MODE:USERID[:ANS:CLICKED]
    const mode = parts[1]; // 'b' or 'x'
    const targetUserId = parseInt(parts[2]);

    logger.debug(`[Welcome] Captcha button parsed: mode=${mode}, targetUserId=${targetUserId}, clickedBy=${ctx.from.id}`, ctx);

    if (ctx.from.id !== targetUserId) {
        logger.warn(`[Welcome] User ${ctx.from.id} tried to answer captcha for user ${targetUserId} - denied`, ctx);
        return ctx.answerCallbackQuery({
            text: '⚠️ Questo captcha non è per te!',
            show_alert: true
        });
    }

    let success = false;
    const config = await getGuildConfig(ctx.chat.id);

    if (mode === 'b') {
        logger.info(`[Welcome] User ${ctx.from.id} clicked simple button captcha - SUCCESS`, ctx);
        success = true;
    } else {
        const correct = parts[3];
        const clicked = parts[4];
        logger.debug(`[Welcome] Captcha answer check: userId=${ctx.from.id}, correct=${correct}, clicked=${clicked}`, ctx);

        if (correct === clicked) {
            logger.info(`[Welcome] User ${ctx.from.id} answered captcha correctly: ${clicked}`, ctx);
            success = true;
        } else {
            logger.info(`[Welcome] User ${ctx.from.id} answered captcha WRONG: expected=${correct}, got=${clicked}`, ctx);
            logWelcomeEvent(ctx, 'FAIL', null, config);
            return ctx.answerCallbackQuery({
                text: '❌ Risposta errata. Riprova.',
                show_alert: true
            });
        }
    }

    if (success) {
        logger.info(`[Welcome] Captcha success for user ${ctx.from.id}, processing verification`, ctx);

        // Get pending info BEFORE removing it
        const pending = await dbStore.getPendingCaptcha(ctx.chat.id, ctx.from.id);
        const serviceMsgId = pending ? pending.service_message_id : null;
        logger.debug(`[Welcome] Retrieved pending captcha data: serviceMsgId=${serviceMsgId}`, ctx);

        await dbStore.removePendingCaptcha(ctx.chat.id, ctx.from.id);
        logger.debug(`[Welcome] Removed pending captcha from DB for user ${ctx.from.id}`, ctx);

        // Check Rules - only show if rules_enabled AND rules_link is set
        const rulesEnabled = config.rules_enabled === true || config.rules_enabled === 1;
        if (rulesEnabled && config.rules_link) {
            logger.info(`[Welcome] Showing rules acceptance screen to user ${ctx.from.id}`, ctx);
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
                            [
                                {
                                    text: '✅ Ho Letto e Accetto',
                                    callback_data: `wc:accept_rules:${ctx.from.id}:${serviceMsgId || 0}`
                                }
                            ]
                        ]
                    }
                });
                logger.debug(`[Welcome] Rules message edited successfully for user ${ctx.from.id}`, ctx);
            } catch (e) {
                // If edit fails, try sending new
                logger.warn(`[Welcome] Failed to edit message for rules, sending new: ${e.message}`, ctx);
                await ctx.deleteMessage().catch(() => { });
                await ctx.reply(text, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔗 Leggi Regolamento', url: rulesLink }],
                            [
                                {
                                    text: '✅ Ho Letto e Accetto',
                                    callback_data: `wc:accept_rules:${ctx.from.id}:${serviceMsgId || 0}`
                                }
                            ]
                        ]
                    }
                });
                logger.debug(`[Welcome] Sent new rules message for user ${ctx.from.id}`, ctx);
            }
            return;
        }

        // No rules, complete verification directly with serviceMsgId
        logger.debug(`[Welcome] No rules required, completing verification for user ${ctx.from.id}`, ctx);
        await completeVerificationWithServiceMsgId(ctx, ctx.from.id, serviceMsgId);
    }
}

/**
 * Completa la verifica dell'utente con serviceMsgId già noto.
 * Sblocca i permessi e invia il messaggio di benvenuto personalizzato.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @param {number} userId - ID dell'utente da sbloccare
 * @param {number|null} serviceMsgId - ID del messaggio di servizio (join)
 * @returns {Promise<void>}
 * @private
 */
async function completeVerificationWithServiceMsgId(ctx, userId, serviceMsgId) {
    logger.info(`[Welcome] Completing verification for user ${userId} in chat ${ctx.chat.id}`, ctx);

    const config = await getGuildConfig(ctx.chat.id);
    logWelcomeEvent(ctx, 'SUCCESS', null, config);

    try {
        logger.debug(`[Welcome] Unrestricting user ${userId}...`, ctx);

        // Get the chat's default permissions to fully restore user to normal member status
        const chat = await ctx.api.getChat(ctx.chat.id);
        const defaultPerms = chat.permissions || {};

        // Apply chat's default permissions to the user
        // Per Telegram API: "Pass True for all permissions to lift restrictions from a user"
        await ctx.restrictChatMember(userId, {
            can_send_messages: true,
            can_send_audios: true,
            can_send_documents: true,
            can_send_photos: true,
            can_send_videos: true,
            can_send_video_notes: true,
            can_send_voice_notes: true,
            can_send_polls: true,
            can_send_other_messages: true,
            can_add_web_page_previews: true,
            can_change_info: true,
            can_invite_users: true,
            can_pin_messages: true,
            can_manage_topics: true
        });
        logger.info(`[Welcome] User ${userId} restrictions lifted - now normal member`, ctx);
    } catch (e) {
        logger.error(`[Welcome] Unrestrict failed for user ${userId}: ${e.message}`, ctx);
    }

    // If welcome message is enabled, try to edit the existing message
    let sentWelcomeId = null;
    if (config.welcome_msg_enabled && config.welcome_message) {
        sentWelcomeId = await sendWelcome(ctx, config, null, ctx.callbackQuery?.message?.message_id);
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

    // Add to Recently Verified (for anti-join-run)
    // We save welcome message ID and service message ID
    await dbStore.addRecentlyVerified(ctx.chat.id, userId, sentWelcomeId, serviceMsgId);

    // Remove from pending (may already be removed, but safe to call)
    await dbStore.removePendingCaptcha(ctx.chat.id, userId);
}

/**
 * Completa la verifica dell'utente (legacy, recupera serviceMsgId dal DB).
 * @deprecated Use completeVerificationWithServiceMsgId instead
 */
async function completeVerification(ctx, userId) {
    const pending = await dbStore.getPendingCaptcha(ctx.chat.id, userId);
    const serviceMsgId = pending ? pending.service_message_id : null;
    await completeVerificationWithServiceMsgId(ctx, userId, serviceMsgId);
}

/**
 * Invia il messaggio di benvenuto personalizzato.
 * Supporta wildcards, pulsanti e auto-eliminazione.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @param {Object} config - Configurazione del gruppo
 * @param {Object|null} [userOverride=null] - Utente da usare invece di ctx.from
 * @param {number|null} [messageToEditId=null] - ID messaggio da modificare (per transizione da captcha)
 * @returns {Promise<number|null>} ID of sent message
 * @private
 */
async function sendWelcome(ctx, config, userOverride = null, messageToEditId = null) {
    if (!config.welcome_msg_enabled) return null;
    if (!config.welcome_message) return null;

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
                await ctx.api.deleteMessage(ctx.chat.id, messageToEditId).catch(() => { });
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
                ctx.api.deleteMessage(ctx.chat.id, sentMessageId).catch(() => { });
            }, config.welcome_autodelete_timer * 60000); // minutes to ms
        }
    } catch (e) {
        logger.error(`[Welcome] Send custom welcome failed: ${e.message}`);
        // Fallback for parsing errors... might be complex to handle with edit vs reply.
        // Simplest is to just log error if it fails after the fallback above.
    }
    return sentMessageId;
}

/**
 * Gestisce l'uscita di un membro dal gruppo.
 * Se l'utente aveva un captcha in sospeso, lo cancella e elimina il messaggio.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @returns {Promise<void>}
 */
async function handleMemberLeft(ctx) {
    // When called from chatMemberFilter('in', 'out'), ctx.chatMember is guaranteed
    // When called from legacy left_chat_member, we need to check
    if (!ctx.chatMember) {
        logger.debug(`[Welcome] handleMemberLeft called without chatMember context, skipping`);
        return;
    }

    const user = ctx.chatMember.old_chat_member.user; // The user who left
    const newStatus = ctx.chatMember.new_chat_member.status;
    const oldStatus = ctx.chatMember.old_chat_member.status;

    logger.info(`[Welcome] User ${user.id} (${user.first_name}) LEFT group ${ctx.chat.id}: ${oldStatus} -> ${newStatus}`, ctx);

    // STRICT CHECK: Only proceed if user strictly LEFT
    // Valid leave states:
    // 1. status is 'left' or 'kicked'
    // 2. status is 'restricted' BUT is_member is false (Restricted user left)
    const isMember = ctx.chatMember.new_chat_member.is_member;
    const isLeft = newStatus === 'left' || newStatus === 'kicked';
    const isRestrictedSafeLeft = newStatus === 'restricted' && isMember === false;

    if (!isLeft && !isRestrictedSafeLeft) {
        logger.debug(`[Welcome] User status is ${newStatus} (is_member=${isMember}). Not a leave event. Ignoring cleanup.`, ctx);
        return;
    }

    logger.debug(`[Welcome] Checking for pending captcha for user ${user.id}...`, ctx);

    // Check Recently Verified "Join & Run"
    try {
        const recent = await dbStore.getRecentlyVerified(ctx.chat.id, user.id);
        if (recent) {
            const now = new Date();
            const verifiedAt = new Date(recent.verified_at);
            const diffMins = (now - verifiedAt) / 60000;

            if (diffMins < 5) {
                // User verified less than 5 mins ago and left!
                logger.info(`[Welcome] User ${user.id} left within 5 mins of verification. Cleaning up.`);

                // Delete Welcome Message
                if (recent.welcome_message_id) {
                    await ctx.api.deleteMessage(ctx.chat.id, recent.welcome_message_id).catch(() => { });
                }

                // Delete Service Message
                if (recent.service_message_id) {
                    await ctx.api.deleteMessage(ctx.chat.id, recent.service_message_id).catch(() => { });
                }
            }

            // Clean up recent record
            await dbStore.removeRecentlyVerified(ctx.chat.id, user.id);
        }
    } catch (e) {
        logger.error(`[Welcome] Failed clean up join-run: ${e.message}`);
    }

    // Remove from DB if exists (Pending Captcha)
    try {
        const pending = await dbStore.getPendingCaptcha(ctx.chat.id, user.id);
        if (pending) {
            await ctx.api.deleteMessage(ctx.chat.id, pending.message_id).catch(() => { });
            if (pending.service_message_id) {
                logger.debug(`[Welcome] handleMemberLeft deleting service message ${pending.service_message_id}`);
                await ctx.api.deleteMessage(ctx.chat.id, pending.service_message_id).catch(() => { });
            }
            await dbStore.removePendingCaptcha(ctx.chat.id, user.id);
            logger.info(`[Welcome] Deleted pending captcha (DB) for user ${user.id} who left.`);

            // Track in recentlyLeftUsers to delete the subsequent "User left" message
            const key = `${ctx.chat.id}:${user.id}`;
            recentlyLeftUsers.add(key);
            // Auto-remove from set after 30 seconds to prevent memory leaks
            setTimeout(() => recentlyLeftUsers.delete(key), 30000);
        }
    } catch (e) {
        logger.debug(`[Welcome] Failed to clean up captcha for leaver: ${e.message}`);
    }
}

/**
 * Controlla i captcha scaduti ed esegue il kick.
 * Da chiamare periodicamente (es. ogni minuto).
 *
 * @param {import('grammy').Bot} bot - Istanza del bot
 */
async function checkExpiredCaptchas(bot) {
    try {
        const expired = await dbStore.getExpiredCaptchas();
        if (!expired.length) return;

        logger.debug(`[Welcome] Found ${expired.length} expired captchas.`);

        for (const record of expired) {
            const { id, guild_id, user_id, message_id, service_message_id } = record;

            // 1. Perform Kick
            let kickSuccess = false;
            try {
                logger.debug(`[Welcome] Expiring captcha for user ${user_id}. ServiceMsgId: ${service_message_id}, CaptchaMsgId: ${message_id}`);

                await bot.api.banChatMember(guild_id, user_id);
                // Wait briefly then unban to just kick
                await new Promise(r => setTimeout(r, 500));
                await bot.api.unbanChatMember(guild_id, user_id);
                kickSuccess = true;
                logger.info(`[Welcome] Kicked user ${user_id} in guild ${guild_id} (captcha expired).`);
            } catch (e) {
                logger.error(`[Welcome] Failed to kick user ${user_id} in ${guild_id}: ${e.message}`);
                // Proceed to cleanup anyway
            }

            // 2. Cleanup Messages (even if kick failed)
            try {
                // Delete Captcha Message
                if (message_id) {
                    logger.debug(`[Welcome] Deleting captcha message ${message_id}`);
                    await bot.api.deleteMessage(guild_id, message_id).catch(err => {
                        // Ignore "message to delete not found" as handleMemberLeft might have deleted it
                        if (err.description && err.description.includes('message to delete not found')) {
                            logger.debug(`[Welcome] Captcha message ${message_id} already deleted (race condition).`);
                        } else {
                            logger.error(`[Welcome] Failed to delete captcha message ${message_id}: ${err.message}`);
                        }
                    });
                }

                // Delete Join Service Message (user joined)
                if (service_message_id) {
                    logger.debug(`[Welcome] Deleting service message ${service_message_id}`);
                    await bot.api.deleteMessage(guild_id, service_message_id).catch(err => {
                        if (err.description && err.description.includes('message to delete not found')) {
                            logger.debug(`[Welcome] Service message ${service_message_id} already deleted (race condition).`);
                        } else {
                            logger.error(`[Welcome] Failed to delete service message ${service_message_id}: ${err.message}`);
                        }
                    });
                } else {
                    logger.warn(`[Welcome] No service_message_id found for user ${user_id} - cannot delete join message.`);
                }

                // Try to delete the kick service message (usually message_id + 1 or +2)
                if (kickSuccess) {
                    // Wait for Telegram to create the kick service message
                    await new Promise(r => setTimeout(r, 1000));
                    for (let offset = 1; offset <= 3; offset++) {
                        await bot.api.deleteMessage(guild_id, message_id + offset).catch(() => { });
                    }
                }
            } catch (e) {
                logger.error(`[Welcome] Failed to clean up messages for ${user_id}: ${e.message}`);
            }

            // 3. Remove from DB & Log
            try {
                // Remove from DB
                await dbStore.removeCaptchaById(id);
                logger.debug(`[Welcome] Removed expired captcha record ${id} from DB`);

                // Log timeout event to log channel
                if (kickSuccess) { // Only log timeout if we actually acted on it, or maybe always? 
                    // Let's log always as "expired", but note if kick failed? Standard log message implies user removed.
                    const config = await getGuildConfig(guild_id);
                    if (config.log_channel_id) {
                        let logEvents = {};
                        if (config.log_events) {
                            if (typeof config.log_events === 'string') {
                                try {
                                    logEvents = JSON.parse(config.log_events);
                                } catch (e) { }
                            } else if (typeof config.log_events === 'object') {
                                logEvents = config.log_events;
                            }
                        }

                        if (logEvents.welcome_captcha_timeout) {
                            // Try to get user info
                            let userName = 'Unknown';
                            try {
                                const userInfo = await bot.api.getChat(user_id);
                                userName = userInfo.first_name || 'Unknown';
                            } catch (e) { }

                            // Get chat info
                            let chatTitle = 'Unknown';
                            try {
                                const chatInfo = await bot.api.getChat(guild_id);
                                chatTitle = chatInfo.title || 'Unknown';
                            } catch (e) { }

                            const lang = await i18n.getLanguage(guild_id);
                            const text = i18n.t(lang, 'welcome.logs.captcha_timeout', {
                                name: userName,
                                userId: user_id,
                                groupName: chatTitle,
                                groupId: guild_id
                            });

                            await bot.api.sendMessage(config.log_channel_id, text, { parse_mode: 'HTML' });
                        }
                    }
                }
            } catch (e) {
                logger.error(`[Welcome] Failed post-expiration cleanup for ${user_id}: ${e.message}`);
                // Ensure removal from DB if above failed
                await dbStore.removeCaptchaById(id).catch(() => { });
            }
        }
    } catch (e) {
        logger.error(`[Welcome] Error in checkExpiredCaptchas: ${e.message}`);
    }
}

module.exports = {
    handleNewMember,
    handleCaptchaCallback,
    checkExpiredCaptchas,
    handleMemberLeft,
    handleLeftMessage
};
