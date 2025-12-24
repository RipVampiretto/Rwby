const logger = require('../../middlewares/logger');
const { updateGuildConfig } = require('../../database/repos/guild');
const ui = require('./ui');
const i18n = require('../../i18n');

// Track active wizard sessions: userId:chatId -> { startTime, type, menuMsgId }
const WIZARD_SESSIONS = new Map();
const SESSION_TTL = 300000; // 5 min

// Cleanup
setInterval(() => {
    const now = Date.now();
    for (const [key, session] of WIZARD_SESSIONS.entries()) {
        if (now - session.startTime > SESSION_TTL) {
            WIZARD_SESSIONS.delete(key);
        }
    }
}, 60000);

function startSession(userId, chatId, menuMsgId, type) {
    const key = `${userId}:${chatId}`;
    WIZARD_SESSIONS.set(key, {
        startTime: Date.now(),
        type: type,
        menuMsgId: menuMsgId
    });
    logger.debug(`[staff-coordination] Wizard session started for ${key} type=${type}`);
}

function stopSession(userId, chatId) {
    const key = `${userId}:${chatId}`;
    WIZARD_SESSIONS.delete(key);
    logger.debug(`[staff-coordination] Wizard session stopped for ${key}`);
}

function hasSession(userId, chatId) {
    return WIZARD_SESSIONS.has(`${userId}:${chatId}`);
}

async function handleMessage(ctx) {
    if (ctx.chat.type === 'private') return false;

    const key = `${ctx.from.id}:${ctx.chat.id}`;
    const session = WIZARD_SESSIONS.get(key);

    if (!session) return false;

    // Helper to Restore Menu
    const restoreMenu = async () => {
        if (session.menuMsgId) {
            try {
                // Determine which menu to send based on context?
                // Mostly it will be the main config UI.
                // We recreate the ctx-like object to pass to ui.sendConfigUI
                // Note: sendConfigUI uses ctx.editMessageText usually, but here we might need to send a new message
                // if the original is too old, or edit it if possible.
                // Since this is triggered by a text message, we can't easily "edit" the text message into the menu.
                // But we want to edit the *original* menu message if possible.

                // Hack: ui.sendConfigUI expects ctx.editMessageText to exist if isEdit=true.
                // We can synthesize a ctx that proxies editMessageText to ctx.api.editMessageText

                const mockCtx = {
                    chat: { id: ctx.chat.id },
                    from: ctx.from,
                    t: ctx.t, // might be undefined here if not using middleware, let's rely on ui internal i18n
                    // Mock editMessageText to target the original menu message
                    editMessageText: async (text, extra) => {
                        return ctx.api.editMessageText(ctx.chat.id, session.menuMsgId, text, extra);
                    },
                    answerCallbackQuery: async () => {}, // No-op
                    reply: (text, extra) => ctx.reply(text, extra) // Fallback
                };

                // We need to fetch DB again inside sendConfigUI so passing null db is risky if not handled.
                // ui.sendConfigUI signature: async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false)
                // We need access to 'db'. The 'db' is usually passed from index.js.
                // We should export 'db' from index.js or import it here?
                // Ideally we pass it in or import the global database instance.
                // Let's import the database module directly as we do for 'updateGuildConfig'.
                const db = require('../../database');

                await ui.sendConfigUI(mockCtx, db, true, true);
            } catch (e) {
                logger.warn(`[staff-coordination] Failed to restore menu: ${e.message}`);
                // Fallback: send new menu
                try {
                    const db = require('../../database');
                    await ui.sendConfigUI(ctx, db, false, true);
                } catch (e2) {}
            }
        }
    };

    // Check cancel
    if (ctx.message.text && ctx.message.text.toLowerCase() === 'cancel') {
        WIZARD_SESSIONS.delete(key);
        try {
            await ctx.deleteMessage();
        } catch (e) {}
        await restoreMenu();
        return true;
    }

    const input = ctx.message.text.trim();

    // Delete user message
    try {
        await ctx.deleteMessage();
    } catch (e) {}

    const lang = await i18n.getLanguage(ctx.chat.id);
    const t = (key, params) => i18n.t(lang, key, params);

    if (session.type === 'set_staff_group') {
        // Validate Group ID (should be negative integer usually)
        if (!/^-?\d+$/.test(input)) {
            const warning = await ctx.reply(t('staff.wizard.invalid_id'));
            setTimeout(() => ctx.api.deleteMessage(ctx.chat.id, warning.message_id).catch(() => {}), 3000);
            return true;
        }

        // Validate bot can access this group
        try {
            const testMsg = await ctx.api.sendMessage(input, '✅ Test connessione Staff Group riuscito.');
            await ctx.api.deleteMessage(input, testMsg.message_id);
        } catch (e) {
            logger.warn(`[staff-coordination] Failed to access staff group ${input}: ${e.message}`);
            const warning = await ctx.reply(t('staff.wizard.access_error'));
            setTimeout(() => ctx.api.deleteMessage(ctx.chat.id, warning.message_id).catch(() => {}), 4000);
            return true;
        }

        await updateGuildConfig(ctx.chat.id, { staff_group_id: input });
        WIZARD_SESSIONS.delete(key);

        await restoreMenu();
        const success = await ctx.reply(t('staff.wizard.group_saved'));
        setTimeout(() => ctx.api.deleteMessage(ctx.chat.id, success.message_id).catch(() => {}), 3000);
        return true;
    }

    if (session.type === 'set_log_channel') {
        // Validate Channel ID
        if (!/^-?\d+$/.test(input)) {
            const warning = await ctx.reply(t('staff.wizard.invalid_id'));
            setTimeout(() => ctx.api.deleteMessage(ctx.chat.id, warning.message_id).catch(() => {}), 3000);
            return true;
        }

        // Validate bot can access this channel
        try {
            const testMsg = await ctx.api.sendMessage(input, '✅ Test connessione Log Channel riuscito.');
            await ctx.api.deleteMessage(input, testMsg.message_id);
        } catch (e) {
            logger.warn(`[staff-coordination] Failed to access log channel ${input}: ${e.message}`);
            const warning = await ctx.reply(t('staff.wizard.access_error'));
            setTimeout(() => ctx.api.deleteMessage(ctx.chat.id, warning.message_id).catch(() => {}), 4000);
            return true;
        }

        await updateGuildConfig(ctx.chat.id, { log_channel_id: input });
        WIZARD_SESSIONS.delete(key);

        await restoreMenu();
        const success = await ctx.reply(t('staff.wizard.channel_saved'));
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
