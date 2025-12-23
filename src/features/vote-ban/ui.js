const { safeEdit } = require('../../utils/error-handlers');
const i18n = require('../../i18n');

async function getVoteMessage(guildId, target, initiator, reason, yes, no, required, expires, voteId, noExpiry = false) {
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const minLeft = Math.max(0, Math.ceil((new Date(expires) - Date.now()) / 60000));
    const timeDisplay = noExpiry ? '♾️' : `${minLeft} min`;

    const text =
        `${t('voteban.vote_message.title')}\n\n` +
        `${t('voteban.vote_message.votes', { current: yes + no, required: required })}\n` +
        `${t('voteban.vote_message.expires', { time: timeDisplay })}\n\n` +
        `_${t('voteban.vote_message.description')}_`;

    const k = {
        inline_keyboard: [
            [
                { text: t('voteban.vote_message.btn_ban', { count: yes }), callback_data: `vote_yes_${voteId}` },
                { text: t('voteban.vote_message.btn_save', { count: no }), callback_data: `vote_no_${voteId}` }
            ]
        ]
    };
    return { text, keyboard: k };
}

/**
 * Get display text for report mode
 */
function getReportModeDisplay(mode, t) {
    const modes = {
        voteban_only: t('voteban.modes.voteban_only'),
        ai_only: t('voteban.modes.ai_only'),
        ai_voteban: t('voteban.modes.ai_voteban')
    };
    return modes[mode] || modes['ai_voteban'];
}

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);

    // Standard VoteBan settings
    const enabled = config.voteban_enabled ? t('common.on') : t('common.off');
    const thr = config.voteban_threshold || 5;
    const dur = config.voteban_duration_minutes;
    const durDisplay = dur === 0 ? t('voteban.disabled_timer') : `${dur} min`;
    const tier = config.voteban_initiator_tier !== undefined ? config.voteban_initiator_tier : 0;
    const tierDisplay = tier === -1 ? t('voteban.everyone') : `T${tier}`;

    // Smart Report settings
    const reportMode = config.report_mode || 'ai_voteban';
    const reportModeDisplay = getReportModeDisplay(reportMode, t);

    const text =
        `${t('voteban.title')}\n\n` +
        `${t('voteban.description')}\n\n` +
        `ℹ️ **${t('voteban.how_to_use')}:**\n` +
        `${t('voteban.usage_info')}\n\n` +
        `💡 **${t('voteban.smart_report_info')}**\n\n` +
        `**${t('voteban.settings_section')}**\n` +
        `${t('voteban.status')}: ${enabled}\n` +
        `${t('voteban.votes_required')}: ${thr}\n` +
        `${t('voteban.timer')}: ${durDisplay}\n` +
        `${t('voteban.tier_initiator')}: ${tierDisplay}\n\n` +
        `**${t('voteban.smart_report_section')}**\n` +
        `${t('voteban.report_mode')}: ${reportModeDisplay}`;

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

    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: 'settings_main' }
        : { text: t('common.close'), callback_data: 'vb_close' };

    const keyboard = {
        inline_keyboard: [
            [{ text: `${t('voteban.buttons.system')}: ${enabled}`, callback_data: 'vb_toggle' }],
            [{ text: `${t('voteban.buttons.threshold')}: ${thr}`, callback_data: 'vb_thr' }],
            [{ text: `${t('voteban.buttons.duration')}: ${durDisplay}`, callback_data: 'vb_dur' }],
            [{ text: `${t('voteban.buttons.tier')}: ${tierDisplay}`, callback_data: 'vb_tier' }],
            [{ text: `📊 ${t('voteban.buttons.report_mode')}: ${reportModeDisplay}`, callback_data: 'vb_mode' }],
            [{ text: `⚙️ ${t('voteban.buttons.category_actions')}`, callback_data: 'vb_cat_actions' }],
            // Log toggle
            [{ text: `📋 Log 🚷${logBan}`, callback_data: 'vb_log_ban' }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'vote-ban');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

/**
 * Get localized action display text
 */
function getActionDisplay(action, t) {
    const actions = {
        delete: t('common.delete'),
        ban: t('common.ban'),
        report_only: t('common.report_only')
    };
    return actions[action] || actions['report_only'];
}

/**
 * Send Smart Report Category Actions UI
 */
async function sendCategoryActionsUI(ctx, db, isEdit = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);
    const config = await db.fetchGuildConfig(guildId);

    // Get current actions for each category (defaults to report_only)
    const scamAction = config.report_action_scam || 'report_only';
    const nsfwAction = config.report_action_nsfw || 'report_only';
    const spamAction = config.report_action_spam || 'report_only';

    const text =
        `${t('smart_report.category_title')}\n\n` +
        `${t('smart_report.category_subtitle')}\n\n` +
        `🎭 **Scam**: ${getActionDisplay(scamAction, t)}\n` +
        `🔞 **NSFW**: ${getActionDisplay(nsfwAction, t)}\n` +
        `📢 **Spam**: ${getActionDisplay(spamAction, t)}`;

    const keyboard = {
        inline_keyboard: [
            [{ text: `🎭 Scam: ${getActionDisplay(scamAction, t)}`, callback_data: 'report_cat_scam' }],
            [{ text: `🔞 NSFW: ${getActionDisplay(nsfwAction, t)}`, callback_data: 'report_cat_nsfw' }],
            [{ text: `📢 Spam: ${getActionDisplay(spamAction, t)}`, callback_data: 'report_cat_spam' }],
            [{ text: t('common.back'), callback_data: 'vb_back_main' }]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'vote-ban');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = {
    getVoteMessage,
    sendConfigUI,
    sendCategoryActionsUI
};
