const logic = require('./logic');
const manage = require('./manage');
const { safeEdit } = require('../../utils/error-handlers');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.modal_enabled ? '✅ ON' : '❌ OFF';
    const action = (config.modal_action || 'report_only').toUpperCase().replace(/_/g, ' ');
    const tierBypass = config.modal_tier_bypass ?? 2;

    // Count active modals for this group's languages
    let allowedLangs = ['it', 'en'];
    try {
        const parsed = JSON.parse(config.allowed_languages || '[]');
        if (parsed.length > 0) allowedLangs = parsed;
    } catch (e) { }

    const modals = logic.getModalsForLanguages(allowedLangs);
    const activeCount = modals.filter(m => m.enabled).length;

    const text = `📋 **MODAL PATTERNS**\n\n` +
        `Sistema di rilevamento spam basato su pattern globali.\n` +
        `I pattern sono organizzati per lingua e categoria.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Pattern caricati per le tue lingue: ${activeCount}\n` +
        `• Lingue gruppo: ${allowedLangs.join(', ').toUpperCase()}\n` +
        `• Solo SuperAdmin possono gestire i pattern\n\n` +
        `Stato: ${enabled}\n` +
        `Azione: ${action}\n` +
        `Bypass Tier: ${tierBypass}+`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "mdl_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `📋 Modals: ${enabled}`, callback_data: "mdl_toggle" }],
            [{ text: `👮 Azione: ${action}`, callback_data: "mdl_act" }],
            [{ text: `🎖️ Bypass Tier: ${tierBypass === -1 ? 'OFF' : tierBypass + '+'}`, callback_data: "mdl_tier" }],
            [{ text: `📝 Gestisci Modali (${activeCount})`, callback_data: "mdl_list" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'modal-patterns');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

async function sendModalListUI(ctx, db, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const guildId = ctx.chat.id;

    // Get group's allowed languages
    let allowedLangs = ['it', 'en'];
    try {
        const parsed = JSON.parse(config.allowed_languages || '[]');
        if (parsed.length > 0) allowedLangs = parsed;
    } catch (e) { }

    const modals = logic.getModalsForLanguages(allowedLangs);

    if (modals.length === 0) {
        const text = "📋 MODALI DISPONIBILI\n\nNessun modal disponibile per le tue lingue.\nI SuperAdmin devono crearli con /gmodal add";
        const keyboard = {
            inline_keyboard: [
                [{ text: "🔙 Indietro", callback_data: "mdl_back" }]
            ]
        };
        if (isEdit) {
            await safeEdit(ctx, text, { reply_markup: keyboard }, 'modal-patterns');
        } else {
            await ctx.reply(text, { reply_markup: keyboard });
        }
        return;
    }

    let text = "📋 MODALI DISPONIBILI\n\nAttiva/disattiva i modali per questo gruppo:\n";

    // Build toggle buttons for each modal
    const buttons = modals.map(m => {
        const isEnabled = logic.isModalEnabledForGuild(guildId, m.id);
        const patterns = logic.safeJsonParse(m.patterns, []);
        const icon = isEnabled ? '✅' : '❌';
        return {
            text: `${icon} ${m.language.toUpperCase()}/${m.category} (${patterns.length})`,
            callback_data: `mdl_tog:${m.id}`
        };
    });

    // Split into rows of 2
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) {
        rows.push(buttons.slice(i, i + 2));
    }
    rows.push([{ text: "🔙 Indietro", callback_data: "mdl_back" }]);

    const keyboard = { inline_keyboard: rows };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard }, 'modal-patterns');
    } else {
        await ctx.reply(text, { reply_markup: keyboard });
    }
}

module.exports = {
    sendConfigUI,
    sendModalListUI
};
