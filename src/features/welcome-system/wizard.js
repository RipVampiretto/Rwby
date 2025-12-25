/**
 * @fileoverview Wizard interattivo per configurazione messaggi di benvenuto
 * @module features/welcome-system/wizard
 *
 * @description
 * Gestisce sessioni wizard per la configurazione dei messaggi di benvenuto.
 * L'utente può impostare:
 * - Messaggio di benvenuto con wildcards
 * - Pulsanti inline (formato: Label,URL | Label2,URL ; Label3,URL3)
 * - Link al regolamento
 *
 * Le sessioni hanno un TTL di 5 minuti e vengono automaticamente pulite.
 */

const logger = require('../../middlewares/logger');
const { updateGuildConfig } = require('../../database/repos/guild');
const ui = require('./ui');
const i18n = require('../../i18n');

/**
 * Mappa delle sessioni wizard attive.
 * Chiave: `userId:chatId`
 * Valore: `{ startTime, type, menuMsgId }`
 * @type {Map<string, {startTime: number, type: string, menuMsgId: number}>}
 * @private
 */
const WIZARD_SESSIONS = new Map();

/**
 * Time-to-live delle sessioni wizard in millisecondi (5 minuti).
 * @constant {number}
 */
const SESSION_TTL = 300000;

// Pulizia automatica sessioni scadute
setInterval(() => {
    const now = Date.now();
    for (const [key, session] of WIZARD_SESSIONS.entries()) {
        if (now - session.startTime > SESSION_TTL) {
            WIZARD_SESSIONS.delete(key);
        }
    }
}, 60000);

/**
 * Avvia una sessione wizard per un utente in una chat.
 *
 * @param {number} userId - ID dell'utente
 * @param {number} chatId - ID della chat
 * @param {number} menuMsgId - ID del messaggio menu da aggiornare dopo il wizard
 * @param {'set_welcome_msg'|'set_rules_link'} [type='set_welcome_msg'] - Tipo di wizard
 */
function startSession(userId, chatId, menuMsgId, type = 'set_welcome_msg') {
    const key = `${userId}:${chatId}`;
    WIZARD_SESSIONS.set(key, {
        startTime: Date.now(),
        type: type,
        menuMsgId: menuMsgId
    });
}

/**
 * Termina una sessione wizard.
 *
 * @param {number} userId - ID dell'utente
 * @param {number} chatId - ID della chat
 */
function stopSession(userId, chatId) {
    const key = `${userId}:${chatId}`;
    WIZARD_SESSIONS.delete(key);
}

/**
 * Verifica se esiste una sessione wizard attiva.
 *
 * @param {number} userId - ID dell'utente
 * @param {number} chatId - ID della chat
 * @returns {boolean} True se esiste una sessione attiva
 */
function hasSession(userId, chatId) {
    return WIZARD_SESSIONS.has(`${userId}:${chatId}`);
}

/**
 * Gestisce i messaggi di testo durante una sessione wizard.
 * Processa l'input dell'utente e salva la configurazione.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY
 * @returns {Promise<boolean>} True se il messaggio è stato gestito dal wizard
 */
async function handleMessage(ctx) {
    if (ctx.chat.type === 'private') return false;

    const key = `${ctx.from.id}:${ctx.chat.id}`;
    const session = WIZARD_SESSIONS.get(key);

    if (!session) return false;

    // Helper to Restore Menu
    const restoreMenu = async () => {
        if (session.menuMsgId) {
            try {
                // Fake ctx for editMessageText on specific message
                // We construct a partial ctx or just call ui.sendWelcomeMenu with a modified ctx
                // But ui.sendWelcomeMenu uses ctx.editMessageText which operates on ctx.msg usually?
                // Or ctx.chat.id + message_id.
                // GrammY editMessageText on ctx targets the message of the update.
                // Here "ctx" is the new text message.
                // So ctx.editMessageText would try to edit the user's text message? No, that's impossible.
                // We must use ctx.api.editMessageText(chat_id, msg_id, text, ...)

                // Let's modify ui.js? Or just call api here.
                // Reusing ui.sendWelcomeMenu is better but it relies on ctx context.
                // Let's manually call ctx.api to restore, or simple hack:
                // We can't reuse ui.sendWelcomeMenu easily if it calls ctx.editMessageText().

                // I will update ui.js to allow passing message_id or just manually do it here?
                // Actually, I can pass a mock ctx to ui.sendWelcomeMenu?
                // { chat: { id: ... }, editMessageText: (text, extra) => ctx.api.editMessageText(chatId, msgId, text, extra) }

                const mockCtx = {
                    chat: { id: ctx.chat.id },
                    editMessageText: (text, extra) =>
                        ctx.api.editMessageText(ctx.chat.id, session.menuMsgId, text, extra)
                };

                await ui.sendWelcomeMenu(mockCtx, true);
            } catch (e) {
                logger.error(`Failed to restore menu: ${e.message}`);
                // If message deleted, maybe send new one?
                if (e.description && e.description.includes('message is not modified')) return;
                try {
                    const mockCtx = {
                        chat: { id: ctx.chat.id },
                        reply: (text, extra) => ctx.reply(text, extra)
                    };
                    await ui.sendWelcomeMenu(mockCtx, false);
                } catch (e2) {}
            }
        }
    };

    // Check cancel
    if (ctx.message.text && ctx.message.text.toLowerCase() === 'cancel') {
        WIZARD_SESSIONS.delete(key);
        // Delete user cancel message
        try {
            await ctx.deleteMessage();
        } catch (e) {}

        await restoreMenu();
        return true;
    }

    if (session.type === 'set_welcome_msg') {
        const input = ctx.message.text;

        // Delete user message to keep chat clean
        try {
            await ctx.deleteMessage();
        } catch (e) {}

        if (!input) {
            const lang = await i18n.getLanguage(ctx.chat.id);
            const warning = await ctx.reply(i18n.t(lang, 'welcome.wizard.text_required'));
            setTimeout(() => ctx.api.deleteMessage(ctx.chat.id, warning.message_id).catch(() => {}), 3000);
            return true;
        }

        const parts = input.split('||');
        const welcomeText = parts[0].trim();
        const buttonConfigStr = parts.length > 1 ? parts.slice(1).join('||').trim() : '';

        if (!welcomeText) {
            const lang = await i18n.getLanguage(ctx.chat.id);
            const warning = await ctx.reply(i18n.t(lang, 'welcome.wizard.text_empty'));
            setTimeout(() => ctx.api.deleteMessage(ctx.chat.id, warning.message_id).catch(() => {}), 3000);
            return true;
        }

        // Parse button config string into Telegram inline_keyboard JSON format
        // Format: Label,URL | Label2,URL ; Label3,URL3
        // | = new row, ; = same row
        let buttonJson = null;
        if (buttonConfigStr) {
            const keyboard = [];
            const rows = buttonConfigStr.split('|');

            for (const row of rows) {
                if (!row.trim()) continue;
                const buttons = [];
                const buttonDefs = row.split(';');

                for (const btnDef of buttonDefs) {
                    const firstCommaIndex = btnDef.indexOf(',');
                    if (firstCommaIndex === -1) continue;

                    const text = btnDef.substring(0, firstCommaIndex).trim();
                    const url = btnDef.substring(firstCommaIndex + 1).trim();

                    if (text && url) {
                        buttons.push({ text, url });
                    }
                }

                if (buttons.length > 0) {
                    keyboard.push(buttons);
                }
            }

            if (keyboard.length > 0) {
                buttonJson = { inline_keyboard: keyboard };
            }
        }

        updateGuildConfig(ctx.chat.id, {
            welcome_message: welcomeText,
            welcome_buttons: buttonJson,
            welcome_msg_enabled: 1
        });

        WIZARD_SESSIONS.delete(key);
        await restoreMenu();
        const lang = await i18n.getLanguage(ctx.chat.id);
        const success = await ctx.reply(i18n.t(lang, 'welcome.wizard.saved'));
        setTimeout(() => ctx.api.deleteMessage(ctx.chat.id, success.message_id).catch(() => {}), 3000);
        return true;
    }

    if (session.type === 'set_rules_link') {
        const input = ctx.message.text;
        try {
            await ctx.deleteMessage();
        } catch (e) {}

        if (!input || (!input.startsWith('http') && !input.startsWith('tg://'))) {
            const lang = await i18n.getLanguage(ctx.chat.id);
            const warning = await ctx.reply(i18n.t(lang, 'welcome.wizard.link_invalid'));
            setTimeout(() => ctx.api.deleteMessage(ctx.chat.id, warning.message_id).catch(() => {}), 3000);
            return true;
        }

        updateGuildConfig(ctx.chat.id, { rules_link: input.trim() });
        WIZARD_SESSIONS.delete(key);
        await restoreMenu();
        const lang = await i18n.getLanguage(ctx.chat.id);
        const success = await ctx.reply(i18n.t(lang, 'welcome.wizard.rules_saved'));
        setTimeout(() => ctx.api.deleteMessage(ctx.chat.id, success.message_id).catch(() => {}), 3000);
        return true;
    }

    return false;
}

module.exports = {
    startSession,
    stopSession,
    hasSession,
    handleMessage
};
