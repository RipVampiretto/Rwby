const { getGuildConfig } = require('../../database/repos/guild');
const i18n = require('../../i18n');
const { replaceWildcards, parseButtonConfig } = require('./utils');

/**
 * Send Welcome System Main Menu
 */
async function sendWelcomeMenu(ctx, isEdit = false) {
    const guildId = ctx.chat.id;
    const config = getGuildConfig(guildId) || {};

    const captchaEnabled = config.captcha_enabled === 1;
    const msgEnabled = config.welcome_msg_enabled === 1;
    const modes = (config.captcha_mode || 'button').split(',');
    const modeDisplay = modes.length > 1 ? `${modes.length} attive` : modes[0];
    const timeout = config.kick_timeout || 5;

    const autoDelete = config.welcome_autodelete_timer || 0;
    const rulesEnabled = config.rules_enabled === 1;
    const logsEnabled = config.captcha_logs_enabled === 1;

    let text = "👋 **Sistema di Benvenuto & Captcha**\n\n";
    text += `🛡️ **Captcha:** ${captchaEnabled ? '✅ ON' : '❌ OFF'}\n`;
    text += `📨 **Benvenuto:** ${msgEnabled ? (config.welcome_message ? '✅ ON' : '⚠️ ON (No Msg)') : '❌ OFF'}\n`;
    text += `🎮 **Modalità:** \`${modeDisplay}\`\n`;
    text += `⏳ **Kick Timeout:** \`${timeout} min\`\n`;
    text += `⏱ **Autodistruzione:** \`${autoDelete === 0 ? 'OFF' : autoDelete + ' sec'}\`\n`;
    text += `📜 **Regolamento:** ${rulesEnabled ? '✅ ON' : '❌ OFF'}\n`;
    text += `🚨 **Log Admin:** ${logsEnabled ? '✅ ON' : '❌ OFF'}\n\n`;

    const keyboard = {
        inline_keyboard: [
            // Row 1: Toggles
            [
                { text: `🛡️ Captcha: ${captchaEnabled ? 'ON' : 'OFF'}`, callback_data: `wc_toggle:captcha:${captchaEnabled ? 0 : 1}` },
                { text: `📨 Msg: ${msgEnabled ? 'ON' : 'OFF'}`, callback_data: `wc_toggle:msg:${msgEnabled ? 0 : 1}` }
            ],
            // Row 2: Advanced Toggles
            [
                { text: `📜 Rules: ${rulesEnabled ? 'ON' : 'OFF'}`, callback_data: `wc_toggle:rules:${rulesEnabled ? 0 : 1}` },
                { text: `🚨 Logs: ${logsEnabled ? 'ON' : 'OFF'}`, callback_data: `wc_toggle:logs:${logsEnabled ? 0 : 1}` }
            ],
            // Row 2b: Rules Link (Conditional)
            ...(rulesEnabled ? [[{ text: "📝 Imposta Link Regolamento", callback_data: "wc_set_rules" }]] : []),
            // Row 3: Timers
            [
                { text: `⏳ Timeout: ${timeout}m`, callback_data: `wc_cycle:timeout:${timeout}` },
                { text: `⏱ AutoDel: ${autoDelete === 0 ? 'OFF' : autoDelete + 's'}`, callback_data: `wc_cycle:autodelete:${autoDelete}` }
            ],
            // Row 4: Mode
            [
                { text: `🎮 Scegli Modalità Captcha`, callback_data: `wc_goto:modes` }
            ],
            // Row 5: Actions
            [
                { text: "✏️ Imposta Benvenuto", callback_data: "wc_set_msg" },
                { text: "🗑️ Rimuovi Benvenuto", callback_data: "wc_del_msg" }
            ],
            // Row 4: Preview
            [
                { text: "👀 Anteprima Completa", callback_data: "wc_goto:preview" }
            ],
            // Row 5: Back
            [
                { text: "🔙 Torna indietro", callback_data: "settings_main" }
            ]
        ]
    };

    if (isEdit) {
        try { await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' }); } catch (e) { }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

/**
 * Send Captcha Mode Submenu
 */
async function sendCaptchaModeMenu(ctx) {
    const config = getGuildConfig(ctx.chat.id) || {};
    const currentModes = (config.captcha_mode || 'button').split(',');

    const isModeActive = (mode) => currentModes.includes(mode);
    const getMark = (mode) => isModeActive(mode) ? '✅' : '';

    let text = "🎮 **Seleziona Modalità Captcha**\n\n";
    text += "Puoi attivare più modalità contemporaneamente. Il bot ne sceglierà una a caso per ogni nuovo utente.\n\n";

    text += "**1. Button** - Clicca 'Non sono un robot'\n";
    text += "**2. Math** - Operazioni (+, -, x)\n";
    text += "**3. Char** - Conta caratteri\n";
    text += "**4. Emoji** - Trova l'emoji corretta\n";
    text += "**5. Color** - Trova il colore corretto\n";
    text += "**6. Logic** - Sequenze logiche\n";
    text += "**7. Reverse** - Parole al contrario\n\n";

    text += `Attive: \`${currentModes.join(', ')}\``;

    const keyboard = {
        inline_keyboard: [
            [
                { text: `${getMark('button')} Button`, callback_data: "wc_toggle_mode:button" },
                { text: `${getMark('math')} Math`, callback_data: "wc_toggle_mode:math" }
            ],
            [
                { text: `${getMark('char')} Char`, callback_data: "wc_toggle_mode:char" },
                { text: `${getMark('emoji')} Emoji`, callback_data: "wc_toggle_mode:emoji" }
            ],
            [
                { text: `${getMark('color')} Color`, callback_data: "wc_toggle_mode:color" },
                { text: `${getMark('logic')} Logic`, callback_data: "wc_toggle_mode:logic" }
            ],
            [
                { text: `${getMark('reverse')} Reverse`, callback_data: "wc_toggle_mode:reverse" }
            ],
            [
                { text: "🔙 Indietro", callback_data: "wc_goto:main" }
            ]
        ]
    };

    try {
        await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    } catch (e) {
        console.error("Edit Mode Menu Error:", e);
    }
    try { await ctx.answerCallbackQuery(); } catch (e) { }
}

/**
 * Send Preview View
 */
async function sendPreview(ctx) {
    const config = getGuildConfig(ctx.chat.id);
    if (!config.welcome_message) {
        return ctx.answerCallbackQuery("⚠️ Nessun messaggio da visualizzare.");
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
    previewKeyboard.push([{ text: "🔙 Torna al menu", callback_data: "wc_goto:main" }]);

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
 * Send Rules Wizard Prompt
 */
async function sendRulesWizardPrompt(ctx) {
    const text = "📜 **Imposta Link Regolamento**\n\n" +
        "Invia ora il link al regolamento (es. `https://t.me/...` o `http://...`).\n" +
        "Questo link verrà usato nel bottone 'Leggi Regolamento'.\n\n" +
        "🔴 *Scrivi 'cancel' per annullare.*";

    const keyboard = {
        inline_keyboard: [
            [{ text: "❌ Annulla", callback_data: "wc_cancel_wizard" }]
        ]
    };

    try {
        await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    } catch (e) { }
}

/**
 * Send Wizard Prompt (Edit)
 */
async function sendWizardPrompt(ctx) {
    const text = "✏️ **Imposta Messaggio di Benvenuto**\n\n" +
        "Invia ora il messaggio che vuoi impostare.\n\n" +
        "**Dati Utente**\n" +
        "`{mention}` - Link cliccabile al nome\n" +
        "`{user}` - Nome visualizzato\n" +
        "`{username}` - @Username (o \"-\")\n" +
        "`{first_name}` - Nome proprio\n" +
        "`{last_name}` - Cognome\n" +
        "`{id}` - ID Utente\n\n" +
        "**Dati Gruppo**\n" +
        "`{mention_group}` - Nome gruppo cliccabile\n" +
        "`{chat_title}` - Nome gruppo\n" +
        "`{chat_username}` - @Tag gruppo (o \"-\")\n" +
        "`{chat_id}` - ID Gruppo\n\n" +
        "**Funzioni Speciali**\n" +
        "`{Testo|URL}` - Link personalizzato (es. `{Regole|https://google.com}`)\n\n" +
        "**Per i bottoni personalizzati:**\n" +
        "Aggiungi `||` alla fine del testo seguito dalla configurazione.\n" +
        "Es: `Messaggio... || Label,URL | Label2,URL`\n\n" +
        "🔴 *Scrivi 'cancel' per annullare.*";

    const keyboard = {
        inline_keyboard: [
            [{ text: "❌ Annulla", callback_data: "wc_cancel_wizard" }]
        ]
    };

    try {
        await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    } catch (e) { }
}

module.exports = {
    sendWelcomeMenu,
    sendCaptchaModeMenu,
    sendPreview,
    sendWizardPrompt,
    sendRulesWizardPrompt
};
