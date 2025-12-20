const { safeEdit } = require('../../utils/error-handlers');
const i18n = require('../../i18n');

function getVoteMessage(guildId, target, initiator, reason, yes, no, required, expires, voteId, noExpiry = false) {
    const t = (key, params) => i18n.t(guildId, key, params);

    const minLeft = Math.max(0, Math.ceil((new Date(expires) - Date.now()) / 60000));
    const timeDisplay = noExpiry ? '♾️' : `${minLeft} min`;

    const text = `${t('voteban.vote_message.title')}\n\n` +
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

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const t = (key, params) => i18n.t(guildId, key, params);

    const config = db.getGuildConfig(guildId);
    const enabled = config.voteban_enabled ? t('common.on') : t('common.off');
    const thr = config.voteban_threshold || 5;
    const dur = config.voteban_duration_minutes;
    const durDisplay = dur === 0 ? t('voteban.disabled_timer') : `${dur} min`;
    const tier = config.voteban_initiator_tier !== undefined ? config.voteban_initiator_tier : 0;
    const tierDisplay = tier === -1 ? 'OFF' : `T${tier}`;

    const text = `${t('voteban.title')}\n\n` +
        `${t('voteban.description')}\n\n` +
        `ℹ️ **${t('voteban.how_to_use')}:**\n` +
        `${t('voteban.usage_info')}\n\n` +
        `${t('voteban.status')}: ${enabled}\n` +
        `${t('voteban.votes_required')}: ${thr}\n` +
        `${t('voteban.timer')}: ${durDisplay}\n` +
        `${t('voteban.tier_initiator')}: ${tierDisplay}`;

    const closeBtn = fromSettings
        ? { text: t('common.back'), callback_data: "settings_main" }
        : { text: t('common.close'), callback_data: "vb_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `${t('voteban.buttons.system')}: ${enabled}`, callback_data: "vb_toggle" }],
            [{ text: `${t('voteban.buttons.threshold')}: ${thr}`, callback_data: "vb_thr" }],
            [{ text: `${t('voteban.buttons.duration')}: ${durDisplay}`, callback_data: "vb_dur" }],
            [{ text: `${t('voteban.buttons.tier')}: ${tierDisplay}`, callback_data: "vb_tier" }],
            [closeBtn]
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
    sendConfigUI
};
