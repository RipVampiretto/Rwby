const logic = require('./logic');
const actions = require('./actions');
const wizard = require('./wizard');
const ui = require('./ui');
const { isAdmin, isFromSettingsMenu } = require('../../utils/error-handlers');

function registerCommands(bot, db) {
    // Middleware: keyword detection
    bot.on("message:text", async (ctx, next) => {
        if (ctx.chat.type === 'private') {
            const sessionKey = `${ctx.from.id}:${ctx.chat.id}`;
            if (wizard.WIZARD_SESSIONS.has(sessionKey)) {
                await wizard.handleWizardStep(ctx, sessionKey);
                return; // Stop propagation
            }
            return next();
        }

        // Handle wizard in group
        const sessionKey = `${ctx.from.id}:${ctx.chat.id}`;
        if (wizard.WIZARD_SESSIONS.has(sessionKey)) {
            await wizard.handleWizardStep(ctx, sessionKey);
            return;
        }

        // Skip for admins
        if (await isAdmin(ctx, 'keyword-monitor')) return next();
        if (ctx.userTier >= 2) return next();

        const match = await logic.scanMessage(ctx);
        if (match) {
            await actions.executeAction(ctx, match.action, match.word, match.fullText);
            return; // Stop processing
        }

        await next();
    });

    // UI Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("wrd_")) return next();

        const fromSettings = isFromSettingsMenu(ctx);

        if (data === "wrd_close") return ctx.deleteMessage();

        if (data === "wrd_list") {
            const rules = db.getDb().prepare('SELECT * FROM word_filters WHERE guild_id = ?').all(ctx.chat.id);
            let msg = "📜 **Word Rules**\n";
            if (rules.length === 0) msg += "Nessuna regola.";
            else rules.slice(0, 20).forEach(r => msg += `- \`${r.word}\` (${r.action})\n`);

            const backBtn = fromSettings
                ? { text: "🔙 Back to Menu", callback_data: "wrd_back_main" }
                : { text: "🔙 Back", callback_data: "wrd_back" };

            try { await ctx.editMessageText(msg, { reply_markup: { inline_keyboard: [[backBtn]] }, parse_mode: 'Markdown' }); } catch (e) { }
            return;
        } else if (data === "wrd_back") {
            return ui.sendConfigUI(ctx, db, true, false);
        } else if (data === "wrd_back_main") {
            return ui.sendConfigUI(ctx, db, true, true);
        } else if (data === "wrd_add") {
            wizard.WIZARD_SESSIONS.set(`${ctx.from.id}:${ctx.chat.id}`, { step: 1, fromSettings: fromSettings, startedAt: Date.now() });
            await ctx.reply("✍️ Digita la parola o regex da bloccare:", { reply_markup: { force_reply: true } });
            await ctx.answerCallbackQuery();
            return;
        } else if (data.startsWith("wrd_wiz_")) {
            // Wizard callback handling
            const sessionKey = `${ctx.from.id}:${ctx.chat.id}`;
            if (!wizard.WIZARD_SESSIONS.has(sessionKey)) return ctx.answerCallbackQuery("Sessione scaduta.");

            const session = wizard.WIZARD_SESSIONS.get(sessionKey);
            if (session.step === 2) {
                if (data === "wrd_wiz_regex_yes") session.is_regex = 1;
                else session.is_regex = 0;

                session.step = 3;
                await ctx.editMessageText(`Azione per \`${session.word}\`?`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🗑️ Delete", callback_data: "wrd_wiz_act_delete" }, { text: "🔨 Ban", callback_data: "wrd_wiz_act_ban" }],
                            [{ text: "⚠️ Report", callback_data: "wrd_wiz_act_report" }]
                        ]
                    }, parse_mode: 'Markdown'
                });
            } else if (session.step === 3) {
                const act = data.split('_act_')[1];
                session.action = act;

                // Save
                db.getDb().prepare(`INSERT INTO word_filters (guild_id, word, is_regex, action, severity, match_whole_word, bypass_tier) VALUES (?, ?, ?, ?, ?, ?, ?)`)
                    .run(ctx.chat.id, session.word, session.is_regex, session.action, 3, session.is_regex ? 0 : 1, 2);

                wizard.WIZARD_SESSIONS.delete(sessionKey);
                await ctx.editMessageText(`✅ Regola aggiunta: \`${session.word}\` -> ${session.action}`, { parse_mode: 'Markdown' });
                // Return to appropriate menu using saved state
                await ui.sendConfigUI(ctx, db, false, session.fromSettings || false);
            }
        } else if (data === "wrd_sync") {
            const config = db.getGuildConfig(ctx.chat.id);
            const newValue = config.keyword_sync_global ? 0 : 1;
            db.updateGuildConfig(ctx.chat.id, { keyword_sync_global: newValue });
            return ui.sendConfigUI(ctx, db, true, fromSettings);
        }
    });
}

module.exports = {
    registerCommands
};
