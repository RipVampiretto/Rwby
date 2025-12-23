const logic = require('./logic');
const actions = require('./actions');
const wizard = require('./wizard');
const ui = require('./ui');
const { isAdmin, isFromSettingsMenu } = require('../../utils/error-handlers');

function registerCommands(bot, db) {
    // Middleware: keyword detection
    bot.on('message:text', async (ctx, next) => {
        if (ctx.chat.type === 'private') {
            const sessionKey = `${ctx.from.id}:${ctx.chat.id}`;
            if (wizard.WIZARD_SESSIONS.has(sessionKey)) {
                await wizard.handleWizardStep(ctx, sessionKey);
                return;
            }
            return next();
        }

        const sessionKey = `${ctx.from.id}:${ctx.chat.id}`;
        if (wizard.WIZARD_SESSIONS.has(sessionKey)) {
            await wizard.handleWizardStep(ctx, sessionKey);
            return;
        }

        if (await isAdmin(ctx, 'keyword-monitor')) return next();
        if (ctx.userTier >= 2) return next();

        const match = await logic.scanMessage(ctx);
        if (match) {
            await actions.executeAction(ctx, match.action, match.word, match.fullText);
            return;
        }

        await next();
    });

    // UI Handlers
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith('wrd_')) return next();

        const fromSettings = isFromSettingsMenu(ctx);

        if (data === 'wrd_close') return ctx.deleteMessage();

        if (data === 'wrd_list') {
            const rules = await db.queryAll('SELECT * FROM word_filters WHERE guild_id = $1', [ctx.chat.id]);
            let msg = '📜 **Word Rules**\n';
            if (rules.length === 0) msg += 'Nessuna regola.';
            else rules.slice(0, 20).forEach(r => (msg += `- \`${r.word}\` (${r.action})\n`));

            const backBtn = fromSettings
                ? { text: '🔙 Back to Menu', callback_data: 'wrd_back_main' }
                : { text: '🔙 Back', callback_data: 'wrd_back' };

            try {
                await ctx.editMessageText(msg, {
                    reply_markup: { inline_keyboard: [[backBtn]] },
                    parse_mode: 'Markdown'
                });
            } catch (e) { }
            return;
        } else if (data === 'wrd_back') {
            return ui.sendConfigUI(ctx, db, true, false);
        } else if (data === 'wrd_back_main') {
            return ui.sendConfigUI(ctx, db, true, true);
        } else if (data === 'wrd_add') {
            wizard.WIZARD_SESSIONS.set(`${ctx.from.id}:${ctx.chat.id}`, {
                step: 1,
                fromSettings: fromSettings,
                startedAt: Date.now()
            });
            await ctx.reply('✍️ Digita la parola o regex da bloccare:', { reply_markup: { force_reply: true } });
            await ctx.answerCallbackQuery();
            return;
        } else if (data.startsWith('wrd_wiz_')) {
            const sessionKey = `${ctx.from.id}:${ctx.chat.id}`;
            if (!wizard.WIZARD_SESSIONS.has(sessionKey)) return ctx.answerCallbackQuery('Sessione scaduta.');

            const session = wizard.WIZARD_SESSIONS.get(sessionKey);
            if (session.step === 2) {
                if (data === 'wrd_wiz_regex_yes') session.is_regex = true;
                else session.is_regex = false;

                session.step = 3;
                await ctx.editMessageText(`Azione per \`${session.word}\`?`, {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🗑️ Delete', callback_data: 'wrd_wiz_act_delete' },
                                { text: '🔨 Ban', callback_data: 'wrd_wiz_act_ban' }
                            ],
                            [{ text: '⚠️ Report', callback_data: 'wrd_wiz_act_report' }]
                        ]
                    },
                    parse_mode: 'Markdown'
                });
            } else if (session.step === 3) {
                const act = data.split('_act_')[1];
                session.action = act;

                await db.query(
                    `INSERT INTO word_filters (guild_id, word, is_regex, action, severity, match_whole_word, bypass_tier) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [ctx.chat.id, session.word, session.is_regex, session.action, 3, !session.is_regex, 2]
                );

                wizard.WIZARD_SESSIONS.delete(sessionKey);
                await ctx.editMessageText(`✅ Regola aggiunta: \`${session.word}\` -> ${session.action}`, {
                    parse_mode: 'Markdown'
                });
                await ui.sendConfigUI(ctx, db, false, session.fromSettings || false);
            }
        } else if (data === 'wrd_sync') {
            const config = await db.getGuildConfig(ctx.chat.id);
            const newValue = !config.keyword_sync_global;
            await db.updateGuildConfig(ctx.chat.id, { keyword_sync_global: newValue });
            return ui.sendConfigUI(ctx, db, true, fromSettings);
        } else if (data.startsWith('wrd_log_')) {
            // Log toggle: wrd_log_delete or wrd_log_ban
            const logType = data.replace('wrd_log_', '');
            const logKey = `keyword_${logType}`;
            const config = await db.getGuildConfig(ctx.chat.id);

            let logEvents = {};
            if (config.log_events) {
                if (typeof config.log_events === 'string') {
                    try { logEvents = JSON.parse(config.log_events); } catch (e) { }
                } else if (typeof config.log_events === 'object') {
                    logEvents = config.log_events;
                }
            }
            logEvents[logKey] = !logEvents[logKey];
            await db.updateGuildConfig(ctx.chat.id, { log_events: logEvents });
            return ui.sendConfigUI(ctx, db, true, fromSettings);
        }
    });
}

module.exports = {
    registerCommands
};
