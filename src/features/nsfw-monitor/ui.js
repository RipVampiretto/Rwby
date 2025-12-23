const { safeEdit } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');
const i18n = require('../../i18n');
const { NSFW_CATEGORIES, getDefaultBlockedCategories } = require('./logic');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    logger.debug(
        `[media-monitor] sendConfigUI called - isEdit: ${isEdit}, fromSettings: ${fromSettings}, chatId: ${guildId}`
    );

    try {
        const config = await db.fetchGuildConfig(guildId);
        const enabled = config.nsfw_enabled ? t('common.on') : t('common.off');

        // Only DELETE or REPORT - no BAN
        const action = config.nsfw_action === 'report_only' ? t('common.actions.report') : t('common.actions.delete');
        const thr = (config.nsfw_threshold || 0.7) * 100;
        const tierBypass = config.nsfw_tier_bypass ?? 2;

        // Toggles
        const p = config.nsfw_check_photos ? '✅' : '❌';
        const v = config.nsfw_check_videos ? '✅' : '❌';
        const g = config.nsfw_check_gifs ? '✅' : '❌';
        const s = config.nsfw_check_stickers ? '✅' : '❌';

        // Count blocked categories
        let blockedCategories = config.nsfw_blocked_categories;
        if (!blockedCategories || !Array.isArray(blockedCategories)) {
            try {
                blockedCategories =
                    typeof blockedCategories === 'string'
                        ? JSON.parse(blockedCategories)
                        : getDefaultBlockedCategories();
            } catch (e) {
                blockedCategories = getDefaultBlockedCategories();
            }
        }
        const blockedCount = blockedCategories.length;

        // Parse log events
        let logEvents = {};
        if (config.log_events) {
            if (typeof config.log_events === 'string') {
                try { logEvents = JSON.parse(config.log_events); } catch (e) { }
            } else if (typeof config.log_events === 'object') {
                logEvents = config.log_events;
            }
        }
        const logDel = logEvents['media_delete'] ? t('common.on') : t('common.off');

        let text =
            `${t('media.title')}\n\n` +
            `${t('media.description')}\n\n` +
            `${t('media.status')}: ${enabled}\n` +
            `${t('media.tier_bypass')}: ${tierBypass === -1 ? 'OFF' : tierBypass + '+'}\n` +
            `${t('media.action')}: ${action}\n` +
            `${t('media.threshold')}: ${thr}%\n` +
            `${t('media.check_types')}: 📷${p} 📹${v} 🎬${g} 🪙${s}\n` +
            `🚫 ${t('media.blocked_categories')}: ${blockedCount}`;

        // Add warning if action is report_only and no staff group
        if (config.nsfw_action === 'report_only' && !config.staff_group_id) {
            text += `\n${t('common.warnings.no_staff_group')}`;
        }

        const closeBtn = fromSettings
            ? { text: t('common.back'), callback_data: 'settings_main' }
            : { text: t('common.close'), callback_data: 'nsf_close' };

        const keyboard = {
            inline_keyboard: [
                [{ text: `${t('media.buttons.monitor')}: ${enabled}`, callback_data: 'nsf_toggle' }],
                [{ text: `${t('media.buttons.tier')}: ${tierBypass === -1 ? 'OFF' : tierBypass + '+'}`, callback_data: 'nsf_tier' }],
                [
                    { text: `${t('media.buttons.action')}: ${action}`, callback_data: 'nsf_act' },
                    { text: `${t('media.buttons.threshold')}: ${thr}%`, callback_data: 'nsf_thr' }
                ],
                [
                    { text: `📷 ${p}`, callback_data: 'nsf_tog_photo' },
                    { text: `📹 ${v}`, callback_data: 'nsf_tog_video' },
                    { text: `🎬 ${g}`, callback_data: 'nsf_tog_gif' },
                    { text: `🪙 ${s}`, callback_data: 'nsf_tog_sticker' }
                ],
                [{ text: `${t('media.buttons.categories')} (${blockedCount})`, callback_data: 'nsf_categories' }],
                [{ text: `📢 ${t('media.buttons.notify')}: ${logDel}`, callback_data: 'nsf_log_delete' }],
                [closeBtn]
            ]
        };

        if (isEdit) {
            await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'media-monitor');
        } else {
            await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
        }
    } catch (e) {
        logger.error(`[media-monitor] sendConfigUI error: ${e.message}`);
        try {
            await ctx.answerCallbackQuery(`Error: ${e.message.substring(0, 50)}`);
        } catch (e2) { }
    }
}

/**
 * Send the categories configuration submenu
 */
async function sendCategoriesUI(ctx, db, fromSettings = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);

    // Get blocked categories
    let blockedCategories = config.nsfw_blocked_categories;
    if (!blockedCategories || !Array.isArray(blockedCategories)) {
        try {
            blockedCategories =
                typeof blockedCategories === 'string' ? JSON.parse(blockedCategories) : getDefaultBlockedCategories();
        } catch (e) {
            blockedCategories = getDefaultBlockedCategories();
        }
    }

    // Build text
    let text = `${t('media.categories_ui.title')}\n\n`;
    text += `${t('media.categories_ui.subtitle')}\n\n`;
    text += `${t('media.categories_ui.legend_title')}\n`;
    text += `${t('media.categories_ui.legend_blocked')}\n`;
    text += `${t('media.categories_ui.legend_always')}\n`;

    // Build keyboard - one row per category
    const keyboard = { inline_keyboard: [] };

    for (const [catId, catInfo] of Object.entries(NSFW_CATEGORIES)) {
        if (catId === 'safe') continue;

        const isBlocked = blockedCategories.includes(catId);
        const isAlwaysBlocked = catInfo.alwaysBlocked === true;
        const canToggle = catInfo.blockable !== false && !isAlwaysBlocked;

        // Get localized name
        const catName = t(`media.categories.${catId}.name`);

        let statusIcon;
        if (isAlwaysBlocked) {
            statusIcon = '🔒';
        } else if (isBlocked) {
            statusIcon = '✅';
        } else {
            statusIcon = '';
        }

        const btnText = statusIcon ? `${statusIcon} ${catName}` : catName;

        if (canToggle) {
            keyboard.inline_keyboard.push([{ text: btnText, callback_data: `nsf_cat_${catId}` }]);
        } else {
            keyboard.inline_keyboard.push([{ text: btnText, callback_data: `nsf_noop` }]);
        }
    }

    // Back button
    keyboard.inline_keyboard.push([
        { text: t('media.categories_ui.back'), callback_data: fromSettings ? 'nsf_back_settings' : 'nsf_back' }
    ]);

    try {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'HTML' }, 'media-monitor');
    } catch (e) {
        logger.error(`[media-monitor] sendCategoriesUI error: ${e.message}`);
    }
}

module.exports = {
    sendConfigUI,
    sendCategoriesUI,
    NSFW_CATEGORIES
};
