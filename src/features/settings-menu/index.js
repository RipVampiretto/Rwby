const antiSpam = require('../anti-spam');
const aiModeration = require('../ai-moderation');
const antiEditAbuse = require('../anti-edit-abuse');
const intelligentProfiler = require('../intelligent-profiler');
const keywordMonitor = require('../keyword-monitor');
const languageMonitor = require('../language-monitor');
const linkMonitor = require('../link-monitor');
const nsfwMonitor = require('../nsfw-monitor');
const visualImmuneSystem = require('../visual-immune-system');
const voteBan = require('../vote-ban');
const adminLogger = require('../admin-logger');
const staffCoordination = require('../staff-coordination');
const intelNetwork = require('../intel-network');
const { safeEdit } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');

let db = null;
let _botInstance = null;

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Command: /settings
    bot.command("settings", async (ctx) => {
        logger.debug(`[settings-menu] /settings command triggered by ${ctx.from.id}`);
        if (ctx.chat.type === 'private') return; // Or handle differently
        // Check admin
        try {
            const member = await ctx.getChatMember(ctx.from.id);
            if (!['creator', 'administrator'].includes(member.status)) return;
        } catch (e) { return; }

        await sendMainMenu(ctx);
    });

    // Callback: settings_main (Back function)
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (data === "settings_main") {
            await sendMainMenu(ctx, true);
            return;
        }

        if (data.startsWith("set_goto:")) {
            const target = data.split(':')[1];
            await routeToFeature(ctx, target);
            return;
        }

        await next();
    });
}

async function sendMainMenu(ctx, isEdit = false) {
    const text = "⚙️ **PANNELLO DI CONTROLLO**\n\nSeleziona un modulo da configurare:";

    // Layout: 2 columns
    const keyboard = {
        inline_keyboard: [
            [
                { text: "🛡️ Anti-Spam", callback_data: "set_goto:antispam" },
                { text: "🤖 AI Mod", callback_data: "set_goto:aimod" }
            ],
            [
                { text: "✏️ Anti-Edit", callback_data: "set_goto:antiedit" },
                { text: "🔍 Profiler", callback_data: "set_goto:profiler" }
            ],
            [
                { text: "🤬 Bad Words", callback_data: "set_goto:badwords" },
                { text: "🌐 Lingua", callback_data: "set_goto:lang" }
            ],
            [
                { text: "🔗 Link Mon", callback_data: "set_goto:links" },
                { text: "🔞 NSFW", callback_data: "set_goto:nsfw" }
            ],
            [
                { text: "🖼️ Visual Sys", callback_data: "set_goto:visual" },
                { text: "🗳️ Vote Ban", callback_data: "set_goto:voteban" }
            ],
            [
                { text: "📜 Logger", callback_data: "set_goto:logger" },
                { text: "👮 Staff", callback_data: "set_goto:staff" }
            ],
            [
                { text: "🧠 Intel Net", callback_data: "set_goto:intel" },
                { text: "❌ Chiudi", callback_data: "settings_close" }
            ]
        ]
    };

    // settings_close handler is simple delete
    if (isEdit) {
        try { await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' }); } catch (e) { }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

async function routeToFeature(ctx, feature) {
    // Call the feature's sendConfigUI with fromSettings=true
    // Note: features need to export sendConfigUI

    switch (feature) {
        case 'antispam':
            if (antiSpam.sendConfigUI) await antiSpam.sendConfigUI(ctx, true, true);
            break;
        case 'aimod':
            if (aiModeration.sendConfigUI) await aiModeration.sendConfigUI(ctx, true, true);
            break;
        case 'antiedit':
            if (antiEditAbuse.sendConfigUI) await antiEditAbuse.sendConfigUI(ctx, true, true);
            break;
        case 'profiler':
            if (intelligentProfiler.sendConfigUI) await intelligentProfiler.sendConfigUI(ctx, true, true);
            break;
        case 'badwords':
            // keywordMonitor has Wizard, might be tricky. Check sendConfigUI
            if (keywordMonitor.sendConfigUI) await keywordMonitor.sendConfigUI(ctx, true, true);
            break;
        case 'lang':
            if (languageMonitor.sendConfigUI) await languageMonitor.sendConfigUI(ctx, true, true);
            break;
        case 'links':
            if (linkMonitor.sendConfigUI) await linkMonitor.sendConfigUI(ctx, true, true);
            break;
        case 'nsfw':
            if (nsfwMonitor.sendConfigUI) await nsfwMonitor.sendConfigUI(ctx, true, true);
            break;
        case 'visual':
            if (visualImmuneSystem.sendConfigUI) await visualImmuneSystem.sendConfigUI(ctx, true, true);
            break;
        case 'voteban':
            if (voteBan.sendConfigUI) await voteBan.sendConfigUI(ctx, true, true);
            break;
        case 'logger':
            if (adminLogger.sendConfigUI) await adminLogger.sendConfigUI(ctx, true, true);
            break;
        case 'staff':
            // staffCoordination usually just commands. Does it have UI? created reviewQueue.
            // /setstaff logic? Maybe we add a simple status UI
            if (staffCoordination.sendConfigUI) await staffCoordination.sendConfigUI(ctx, true, true);
            else await ctx.answerCallbackQuery("Configurazione Staff via comandi (/setstaff)");
            break;
        case 'intel':
            if (intelNetwork.sendConfigUI) await intelNetwork.sendConfigUI(ctx, true, true);
            else await ctx.answerCallbackQuery("Status Intel via /intel");
            break;
    }
}

// Handler for settings_close
function registerClose(bot) {
    bot.on("callback_query:data", async (ctx, next) => {
        if (ctx.callbackQuery.data === 'settings_close') {
            await ctx.deleteMessage();
        } else {
            await next();
        }
    });
}

module.exports = { register };
