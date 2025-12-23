/**
 * Album Batching Module for NSFW Monitor
 * Buffers album items and processes them as a single unit
 * 
 * ARCHITECTURE:
 * 1. When media arrives -> start analysis IMMEDIATELY (non-blocking)
 * 2. Store the analysis Promise in the buffer
 * 3. Timer only waits for all media to arrive (800ms after last)
 * 4. When timer fires, wait for ALL analysis Promises to complete
 * 5. Then execute batched action with all violations
 */

const logic = require('./logic');
const actions = require('./actions');
const logger = require('../../middlewares/logger');

// Album buffer: media_group_id -> { analysisPromises: [], timer, config, chatId, userId }
const ALBUM_BUFFER = new Map();
const ALBUM_TIMEOUT = 3000; // ms to wait for all album items to arrive (increased for slow Telegram delivery)

/**
 * Add a media item to the album buffer and start analysis immediately
 * @param {Context} ctx - grammY context
 * @param {Object} config - Guild config
 */
function bufferAlbumItem(ctx, config) {
    const mediaGroupId = ctx.message.media_group_id;
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id;

    if (!ALBUM_BUFFER.has(mediaGroupId)) {
        ALBUM_BUFFER.set(mediaGroupId, {
            analysisPromises: [],
            timer: null,
            config,
            chatId,
            userId
        });
    }

    const album = ALBUM_BUFFER.get(mediaGroupId);

    // Start analysis IMMEDIATELY (non-blocking)
    const analysisPromise = analyzeItem(ctx, config);
    album.analysisPromises.push(analysisPromise);

    // Clear existing timer and set new one
    if (album.timer) {
        clearTimeout(album.timer);
    }

    album.timer = setTimeout(async () => {
        await processAlbum(mediaGroupId);
    }, ALBUM_TIMEOUT);

    logger.debug(`[nsfw-monitor] 📦 Buffered album item ${album.analysisPromises.length} for group ${mediaGroupId} - analysis started`);
}

/**
 * Analyze a single media item (returns Promise)
 * @param {Context} ctx
 * @param {Object} config
 * @returns {Promise<{ctx, result}>}
 */
async function analyzeItem(ctx, config) {
    try {
        const result = await logic.analyzeMediaOnly(ctx, config);
        return { ctx, result };
    } catch (err) {
        logger.error(`[nsfw-monitor] ❌ Album item analysis error: ${err.message}`);
        return { ctx, result: { isNsfw: false } };
    }
}

/**
 * Process all items in an album after all analyses complete
 * @param {string} mediaGroupId - The album's media_group_id
 */
async function processAlbum(mediaGroupId) {
    const album = ALBUM_BUFFER.get(mediaGroupId);
    if (!album) return;

    ALBUM_BUFFER.delete(mediaGroupId);

    const { analysisPromises, config, chatId, userId } = album;
    logger.info(`[nsfw-monitor] 📦 Waiting for ${analysisPromises.length} album analyses to complete - Chat: ${chatId}, User: ${userId}`);

    // Wait for ALL analyses to complete (this is the key fix!)
    const results = await Promise.all(analysisPromises);

    // Collect violations
    const violations = [];
    for (const { ctx, result } of results) {
        if (result && result.isNsfw) {
            violations.push({
                ctx,
                reason: result.reason,
                type: result.type
            });
        }
    }

    if (violations.length > 0) {
        logger.warn(`[nsfw-monitor] 🚨 Album has ${violations.length}/${results.length} violations`);
        await actions.executeAlbumAction(violations, config);
    } else {
        logger.info(`[nsfw-monitor] ✅ Album is SAFE - ${results.length} items checked`);
    }
}

/**
 * Check if a message is part of an album
 * @param {Context} ctx - grammY context
 * @returns {boolean}
 */
function isAlbumItem(ctx) {
    return !!ctx.message?.media_group_id;
}

module.exports = {
    bufferAlbumItem,
    processAlbum,
    isAlbumItem,
    ALBUM_BUFFER
};
