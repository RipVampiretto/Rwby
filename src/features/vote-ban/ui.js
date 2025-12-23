const { safeEdit } = require('../../utils/error-handlers');
const i18n = require('../../i18n');

async function getVoteMessage(guildId, target, initiator, actionType, yes, no, required, expires, voteId) {
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const minLeft = Math.max(0, Math.ceil((new Date(expires) - Date.now()) / 60000));
    const actionDisplay = actionType === 'ban' ? '🚷 BAN' : '🗑️ DELETE';

    const text =
        `${t('report.vote_message.title')}\n\n` +
        `${t('report.vote_message.action')}: ${actionDisplay}\n` +
        `${t('report.vote_message.votes', { current: yes + no, required: required })}\n` +
        `${t('report.vote_message.expires', { time: `${minLeft} min` })}\n\n` +
        `_${t('report.vote_message.description')}_`;

    const k = {
        inline_keyboard: [
            [
                { text: t('report.vote_message.btn_yes', { count: yes }), callback_data: `vote_yes_${voteId}` },
                { text: t('report.vote_message.btn_no', { count: no }), callback_data: `vote_no_${voteId}` }
            ]
        ]
    };
    return { text, keyboard: k };
}

function getActionDisplay(action, t) {
    const actions = {
        delete: t('common.delete'),
        ban: t('common.ban'),
        report_only: t('common.report_only')
    };
    return actions[action] || actions['report_only'];
}

async function sendConfigUI(ctx, db, isEdit = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);

    const enabled = config.voteban_enabled ? t('common.on') : t('common.off');
    const thr = config.voteban_threshold || 5;
    const dur = config.voteban_duration_minutes || 30;
    const durDisplay = dur === 0 ? '♾️' : `${dur} min`;

    const reportMode = config.report_mode || 'ai_voteban';
    const modeDisplay = {
        'ai_only': t('report.modes.ai_only'),
        'voteban_only': t('report.modes.voteban_only'),
        'ai_voteban': t('report.modes.ai_voteban')
    }[reportMode] || t('report.modes.ai_voteban');

    let text =
        `${t('report.title')}\n\n` +
        `${t('report.description')}\n\n` +
        `ℹ️ **${t('report.how_to_use')}:**\n` +
        `${t('report.usage_info')}\n\n` +
        `📊 **${t('report.modes_title')}:**\n` +
        `• **${t('report.modes.ai_only')}** - ${t('report.modes.ai_only_desc')}\n` +
        `• **${t('report.modes.voteban_only')}** - ${t('report.modes.voteban_only_desc')}\n` +
        `• **${t('report.modes.ai_voteban')}** - ${t('report.modes.ai_voteban_desc')}\n\n` +
        `**${t('report.settings_section')}**\n` +
        `${t('report.status')}: ${enabled}\n` +
        `${t('report.report_mode')}: ${modeDisplay}\n` +
        `${t('report.votes_required')}: ${thr}\n` +
        `${t('report.timer')}: ${durDisplay}`;

    if (!config.staff_group_id) {
        text += `\n\n${t('common.warnings.no_staff_group')}`;
    }

    // Parse log events
    let logEvents = {};
    if (config.log_events) {
        if (typeof config.log_events === 'string') {
            try { logEvents = JSON.parse(config.log_events); } catch (e) { }
        } else if (typeof config.log_events === 'object') {
            logEvents = config.log_events;
        }
    }
    const logBan = logEvents['vote_ban'] ? '✅' : '❌';
    const logDel = logEvents['vote_delete'] ? '✅' : '❌';

    const keyboard = {
        inline_keyboard: [
            [{ text: `${t('report.buttons.system')}: ${enabled}`, callback_data: 'vb_toggle' }],
            [{ text: `${t('report.buttons.report_mode')}: ${modeDisplay}`, callback_data: 'vb_mode' }],
            [{ text: `${t('report.buttons.threshold')}: ${thr}`, callback_data: 'vb_thr' }],
            [{ text: `${t('report.buttons.duration')}: ${durDisplay}`, callback_data: 'vb_dur' }],
            [{ text: `⚙️ ${t('report.buttons.category_actions')}`, callback_data: 'vb_categories' }],
            [
                { text: `Log 🗑️${logDel}`, callback_data: 'vb_log_delete' },
                { text: `Log 🚷${logBan}`, callback_data: 'vb_log_ban' }
            ],
            [{ text: t('common.back'), callback_data: 'settings_main' }]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'report');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

/**
 * Category Actions Submenu
 */
async function sendCategoryActionsUI(ctx, db, isEdit = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);

    const scamAction = getActionDisplay(config.report_action_scam || 'report_only', t);
    const nsfwAction = getActionDisplay(config.report_action_nsfw || 'report_only', t);
    const hateAction = getActionDisplay(config.report_action_hate || 'report_only', t);

    const text =
        `⚙️ **${t('report.category_title')}**\n\n` +
        `${t('report.category_subtitle')}\n\n` +
        `🎭 **Scam**: ${scamAction}\n` +
        `🔞 **NSFW**: ${nsfwAction}\n` +
        `💢 **Hate**: ${hateAction}`;

    const keyboard = {
        inline_keyboard: [
            [{ text: `🎭 Scam: ${scamAction}`, callback_data: 'vb_cat_scam' }],
            [{ text: `🔞 NSFW: ${nsfwAction}`, callback_data: 'vb_cat_nsfw' }],
            [{ text: `💢 Hate: ${hateAction}`, callback_data: 'vb_cat_hate' }],
            [{ text: t('common.back'), callback_data: 'vb_back_main' }]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'report');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

/**
 * Confirmation prompt (2-minute timeout)
 */
async function sendConfirmationPrompt(ctx, targetUser, targetMsgId) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const targetName = targetUser.username ? `@${targetUser.username}` : targetUser.first_name;

    const text = `${t('report.confirm.title')}\n\n` +
        `${t('report.confirm.target')}: ${targetName}\n\n` +
        `${t('report.confirm.instruction')}\n` +
        `_${t('report.confirm.timeout')}_`;

    const keyboard = {
        inline_keyboard: [
            [
                { text: '🗑️ Delete', callback_data: `vb_confirm:delete:${targetUser.id}:${targetMsgId}:${ctx.from.id}` },
                { text: '🚷 Ban', callback_data: `vb_confirm:ban:${targetUser.id}:${targetMsgId}:${ctx.from.id}` }
            ],
            [{ text: t('common.cancel'), callback_data: `vb_confirm:cancel:${targetUser.id}:${targetMsgId}:${ctx.from.id}` }]
        ]
    };

    return await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
}

module.exports = {
    getVoteMessage,
    sendConfigUI,
    sendCategoryActionsUI,
    sendConfirmationPrompt,
    getActionDisplay
};
