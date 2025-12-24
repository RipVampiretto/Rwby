const actionLog = require('../action-log');
const superAdmin = require('../super-admin');
const staffCoordination = require('../staff-coordination');
const i18n = require('../../i18n');
const { safeDelete } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');

/**
 * Send media to a channel using file_id (not forward)
 * @param {Context} ctx - grammY context
 * @param {string} channelId - Target channel ID
 * @param {string} caption - Optional caption
 */
async function sendMediaToChannel(ctx, channelId, caption = null) {
    const msg = ctx.message;
    const options = caption ? { caption, parse_mode: 'HTML' } : {};

    try {
        if (msg.photo) {
            const photo = msg.photo[msg.photo.length - 1];
            await ctx.api.sendPhoto(channelId, photo.file_id, options);
        } else if (msg.video) {
            await ctx.api.sendVideo(channelId, msg.video.file_id, options);
        } else if (msg.animation) {
            await ctx.api.sendAnimation(channelId, msg.animation.file_id, options);
        } else if (msg.sticker) {
            await ctx.api.sendSticker(channelId, msg.sticker.file_id);
        } else if (msg.document) {
            await ctx.api.sendDocument(channelId, msg.document.file_id, options);
        }
    } catch (e) {
        logger.debug(`[media-filter] sendMediaToChannel error: ${e.message}`);
    }
}

async function executeAction(ctx, action, reason, type) {
    const user = ctx.from;

    // Parse log events from config
    const db = require('../../database');
    const config = await db.getGuildConfig(ctx.chat.id);
    let logEvents = {};
    if (config.log_events) {
        if (typeof config.log_events === 'string') {
            try {
                logEvents = JSON.parse(config.log_events);
            } catch (e) {}
        } else if (typeof config.log_events === 'object') {
            logEvents = config.log_events;
        }
    }

    // Simplify reason for logs (remove technical details like "Frame @...")
    let simpleReason = reason;
    try {
        // Extract category name if possible (remove frame info and percent)
        // Example: "Frame @3.6s: Real Sex (95%)" -> "Real Sex"
        // Example: "Real Sex (95%)" -> "Real Sex"
        const match = reason.match(/(?:Frame @[\d.]+s: )?([^(\n]+)/);
        if (match && match[1]) {
            simpleReason = match[1].trim();
        }
    } catch (e) {
        simpleReason = reason;
    }

    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'media_delete',
        targetUser: user,
        reason: `Categoria vietata: ${simpleReason}`,
        isGlobal: false
    };

    if (action === 'delete') {
        // Send original media to Log Channel (if set) BEFORE deleting
        if (config.log_channel_id) {
            await sendMediaToChannel(ctx, config.log_channel_id);
        }

        // Forward original media to Parliament BEFORE deleting (with gban option)
        if (superAdmin.forwardMediaToParliament) {
            const parlLang = await i18n.getLanguage(ctx.chat.id);
            const t = key => i18n.t(parlLang, key);
            const caption =
                `🖼️ <b>NSFW CONTENT</b>\n\n` +
                `${t('common.logs.group')}: ${ctx.chat.title}\n` +
                `${t('common.logs.user')}: <a href="tg://user?id=${user.id}">${user.first_name}</a> [<code>${user.id}</code>]\n` +
                `📝 Category: ${reason}\n` +
                `📁 Type: ${type}`;

            await superAdmin.forwardMediaToParliament('image_spam', ctx, caption, [
                [
                    { text: t('common.logs.global_ban_user'), callback_data: `gban:${user.id}` },
                    { text: '✅ Ignore', callback_data: 'parl_dismiss' }
                ]
            ]);
        }

        // Delete message
        await safeDelete(ctx, 'media-monitor');

        // Send warning to user (auto-delete after 1 minute)
        try {
            const lang = await i18n.getLanguage(ctx.chat.id);
            const userName = user.username
                ? `@${user.username}`
                : `<a href="tg://user?id=${user.id}">${user.first_name}</a>`;
            const warningMsg = i18n.t(lang, 'media.warning', { user: userName });

            const warning = await ctx.reply(warningMsg, { parse_mode: 'HTML' });
            setTimeout(async () => {
                try {
                    await ctx.api.deleteMessage(ctx.chat.id, warning.message_id);
                } catch (e) {}
            }, 60000);
        } catch (e) {}

        // Log only if enabled
        if (logEvents['media_delete'] && actionLog.getLogEvent()) {
            actionLog.getLogEvent()(logParams);
        }
    } else if (action === 'report_only') {
        // Forward to staff group for review
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Media-AI',
            user: user,
            reason: reason,
            messageId: ctx.message.message_id,
            content: `[Media ${type}]`
        });
    }
}

/**
 * Execute batched action for album violations
 * @param {Array} violations - Array of {ctx, reason, type}
 * @param {Object} config - Guild config
 */
async function executeAlbumAction(violations, config) {
    if (!violations || violations.length === 0) return;

    const firstCtx = violations[0].ctx;
    const user = firstCtx.from;
    const action = config.nsfw_action || 'delete';

    // Parse log events from config
    const db = require('../../database');
    let logEvents = {};
    if (config.log_events) {
        if (typeof config.log_events === 'string') {
            try {
                logEvents = JSON.parse(config.log_events);
            } catch (e) {}
        } else if (typeof config.log_events === 'object') {
            logEvents = config.log_events;
        }
    }

    // Aggregate reasons
    const categories = [
        ...new Set(
            violations.map(v => {
                const match = v.reason?.match(/(?:Frame @[\d.]+s: )?([^(\n]+)/);
                return match ? match[1].trim() : v.reason;
            })
        )
    ];
    const aggregatedReason = categories.join(', ');

    const logParams = {
        guildId: firstCtx.chat.id,
        eventType: 'media_delete',
        targetUser: user,
        reason: `Album (${violations.length} media): ${aggregatedReason}`,
        isGlobal: false
    };

    if (action === 'delete') {
        // Prepare media group from all violations
        const mediaItems = violations
            .map((v, idx) => {
                const msg = v.ctx.message;
                let item = null;
                if (msg.photo) {
                    const photo = msg.photo[msg.photo.length - 1];
                    item = { type: 'photo', media: photo.file_id };
                } else if (msg.video) {
                    item = { type: 'video', media: msg.video.file_id };
                } else if (msg.animation) {
                    // Animations can't be in media group, treat as document
                    item = { type: 'document', media: msg.animation.file_id };
                } else if (msg.document) {
                    item = { type: 'document', media: msg.document.file_id };
                }
                // Add caption only to first item
                if (item && idx === 0) {
                    item.caption = `🚫 Album eliminato: ${aggregatedReason}`;
                }
                return item;
            })
            .filter(Boolean);

        // Send album to Log Channel
        if (config.log_channel_id && mediaItems.length > 0) {
            try {
                if (mediaItems.length === 1) {
                    await sendMediaToChannel(firstCtx, config.log_channel_id);
                } else {
                    await firstCtx.api.sendMediaGroup(config.log_channel_id, mediaItems);
                }
            } catch (e) {
                logger.debug(`[media-filter] sendMediaGroup to log error: ${e.message}`);
            }
        }

        // Send album to Parliament with summary
        if (superAdmin.forwardAlbumToParliament) {
            await superAdmin.forwardAlbumToParliament('image_spam', violations, {
                groupTitle: firstCtx.chat.title,
                user: user,
                reason: aggregatedReason,
                count: violations.length
            });
        } else if (superAdmin.forwardMediaToParliament) {
            // Fallback to single media
            const parlLang = await i18n.getLanguage(firstCtx.chat.id);
            const t = key => i18n.t(parlLang, key);
            const caption =
                `🖼️ <b>NSFW ALBUM</b>\n\n` +
                `${t('common.logs.group')}: ${firstCtx.chat.title}\n` +
                `${t('common.logs.user')}: <a href="tg://user?id=${user.id}">${user.first_name}</a> [<code>${user.id}</code>]\n` +
                `📁 Deleted media: ${violations.length}\n` +
                `📝 Categories: ${aggregatedReason}`;

            await superAdmin.forwardMediaToParliament('image_spam', firstCtx, caption, [
                [
                    { text: t('common.logs.global_ban_user'), callback_data: `gban:${user.id}` },
                    { text: '✅ Ignore', callback_data: 'parl_dismiss' }
                ]
            ]);
        }

        // Delete all violating messages
        for (const v of violations) {
            await safeDelete(v.ctx, 'media-monitor-album');
        }

        // Send single warning to user (auto-delete after 1 minute) - use plural version
        try {
            const lang = await i18n.getLanguage(firstCtx.chat.id);
            const userName = user.username
                ? `@${user.username}`
                : `<a href="tg://user?id=${user.id}">${user.first_name}</a>`;
            // Use plural warning for albums
            const warningKey = violations.length > 1 ? 'media.warning_album' : 'media.warning';
            let warningMsg = i18n.t(lang, warningKey, { user: userName, count: violations.length });
            // Fallback to singular if plural key missing
            if (warningMsg === warningKey) {
                warningMsg = i18n.t(lang, 'media.warning', { user: userName });
            }

            const warning = await firstCtx.reply(warningMsg, { parse_mode: 'HTML' });
            setTimeout(async () => {
                try {
                    await firstCtx.api.deleteMessage(firstCtx.chat.id, warning.message_id);
                } catch (e) {}
            }, 60000);
        } catch (e) {}

        // Log only if enabled (single log for entire album)
        if (logEvents['media_delete'] && actionLog.getLogEvent()) {
            actionLog.getLogEvent()(logParams);
        }
    } else if (action === 'report_only') {
        // Forward to staff group for review (single report)
        staffCoordination.reviewQueue({
            guildId: firstCtx.chat.id,
            source: 'Media-AI (Album)',
            user: user,
            reason: `Album: ${aggregatedReason}`,
            messageId: firstCtx.message.message_id,
            content: `[Album: ${violations.length} media]`
        });
    }
}

module.exports = {
    executeAction,
    executeAlbumAction
};
