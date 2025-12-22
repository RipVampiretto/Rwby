const { safeEdit } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');
const i18n = require('../../i18n');
const { NSFW_CATEGORIES, getDefaultBlockedCategories } = require('./logic');

async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const t = (key, params) => i18n.t(guildId, key, params);

    logger.debug(
        `[nsfw-monitor] sendConfigUI called - isEdit: ${isEdit}, fromSettings: ${fromSettings}, chatId: ${guildId}`
    );

    try {
        const config = await db.fetchGuildConfig(guildId);
        const enabled = config.nsfw_enabled ? t('common.on') : t('common.off');
        const action = i18n.formatAction(guildId, config.nsfw_action || 'delete');
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

        let text =
            `${t('nsfw.title')}\n\n` +
            `${t('nsfw.description')}\n\n` +
            `ℹ️ <b>${t('nsfw.info_title')}:</b>\n` +
            `• ${t('nsfw.info_1')}\n` +
            `• ${t('nsfw.info_2')}\n` +
            `• ${t('nsfw.info_3')}\n\n` +
            `${t('nsfw.status')}: ${enabled}\n` +
            `${t('nsfw.tier_bypass')}: ${tierBypass === -1 ? 'OFF' : tierBypass + '+'}\n` +
            `${t('nsfw.action')}: ${action}\n` +
            `${t('nsfw.threshold')}: ${thr}%\n` +
            `${t('nsfw.check_types')}: Foto ${p} | Video ${v} | GIF ${g} | Sticker ${s}\n` +
            `🚫 ${t('nsfw.blocked_categories')}: ${blockedCount}`;

        // Add warning if action is report_only and no staff group
        if (config.nsfw_action === 'report_only' && !config.staff_group_id) {
            text += `\n${t('common.warnings.no_staff_group')}`;
        }

        const closeBtn = fromSettings
            ? { text: t('common.back'), callback_data: 'settings_main' }
            : { text: t('common.close'), callback_data: 'nsf_close' };

        const keyboard = {
            inline_keyboard: [
                [{ text: `${t('nsfw.buttons.monitor')}: ${enabled}`, callback_data: 'nsf_toggle' }],
                [
                    {
                        text: `${t('nsfw.buttons.tier')}: ${tierBypass === -1 ? 'OFF' : tierBypass + '+'}`,
                        callback_data: 'nsf_tier'
                    }
                ],
                [
                    { text: `${t('nsfw.buttons.action')}: ${action}`, callback_data: 'nsf_act' },
                    { text: `${t('nsfw.buttons.threshold')}: ${thr}%`, callback_data: 'nsf_thr' }
                ],
                [
                    { text: `📷 ${p}`, callback_data: 'nsf_tog_photo' },
                    { text: `📹 ${v}`, callback_data: 'nsf_tog_video' }
                ],
                [
                    { text: `🎬 ${g}`, callback_data: 'nsf_tog_gif' },
                    { text: `🪙 ${s}`, callback_data: 'nsf_tog_sticker' }
                ],
                [{ text: `${t('nsfw.buttons.categories')} (${blockedCount})`, callback_data: 'nsf_categories' }],
                [closeBtn]
            ]
        };

        if (isEdit) {
            await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'HTML' }, 'nsfw-monitor');
        } else {
            await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
        }
    } catch (e) {
        logger.error(`[nsfw-monitor] sendConfigUI error: ${e.message}`);
        try {
            await ctx.answerCallbackQuery(`Error: ${e.message.substring(0, 50)}`);
        } catch (e2) {}
    }
}

/**
 * Send the categories configuration submenu
 */
async function sendCategoriesUI(ctx, db, fromSettings = false) {
    const guildId = ctx.chat.id;
    const t = (key, params) => i18n.t(guildId, key, params);

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

    // Build text with legend and descriptions
    let text = `${t('nsfw.categories_ui.title')}\n\n`;
    text += `${t('nsfw.categories_ui.subtitle')}\n\n`;
    text += `${t('nsfw.categories_ui.legend_title')}\n`;
    text += `${t('nsfw.categories_ui.legend_blocked')}\n`;
    text += `${t('nsfw.categories_ui.legend_always')}\n\n`;

    // Add category descriptions
    for (const [catId, catInfo] of Object.entries(NSFW_CATEGORIES)) {
        if (catId === 'safe') continue;
        const catName = t(`nsfw.categories.${catId}.name`);
        const catDesc = t(`nsfw.categories.${catId}.desc`);
        text += `• <b>${catName}</b>: ${catDesc}\n`;
    }
    text += '\n'; // Add a newline after descriptions for better spacing

    // Build keyboard - one row per category
    const keyboard = { inline_keyboard: [] };

    for (const [catId, catInfo] of Object.entries(NSFW_CATEGORIES)) {
        if (catId === 'safe') continue; // Don't show "safe" category

        const isBlocked = blockedCategories.includes(catId);
        const isAlwaysBlocked = catInfo.alwaysBlocked === true;
        const canToggle = catInfo.blockable !== false && !isAlwaysBlocked;

        // Get localized name
        const catName = t(`nsfw.categories.${catId}.name`);

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
            // Non-clickable (always blocked)
            keyboard.inline_keyboard.push([{ text: btnText, callback_data: `nsf_noop` }]);
        }
    }

    // Back button
    keyboard.inline_keyboard.push([
        { text: t('nsfw.categories_ui.back'), callback_data: fromSettings ? 'nsf_back_settings' : 'nsf_back' }
    ]);

    try {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'HTML' }, 'nsfw-monitor');
    } catch (e) {
        logger.error(`[nsfw-monitor] sendCategoriesUI error: ${e.message}`);
    }
}

module.exports = {
    sendConfigUI,
    sendCategoriesUI,
    NSFW_CATEGORIES
};
