// ============================================================================
// SMART REPORT - UNIFIED ANALYSIS ENGINE
// ============================================================================
// Combines NSFW Vision AI + Text AI Moderation for @admin reports
// ============================================================================

const logger = require('../../middlewares/logger');
const nsfwLogic = require('../nsfw-monitor/logic');
const aiApi = require('../ai-moderation/api');
const { getContext } = require('../ai-moderation/context');

/**
 * Analyze a single target message (reply mode)
 * @param {object} ctx - Telegram context (with reply_to_message)
 * @param {object} config - Guild config
 * @returns {Promise<{isViolation: boolean, category: string, reason: string, action: string}>}
 */
async function analyzeTarget(ctx, config) {
    const targetMsg = ctx.message.reply_to_message;
    if (!targetMsg) return { isViolation: false };

    logger.info(`[smart-report] Analyzing target message ${targetMsg.message_id}`);

    // Check NSFW (if media present) - Smart Report always analyzes regardless of nsfw_enabled
    if (hasMedia(targetMsg)) {
        logger.info(`[smart-report] Checking media for NSFW...`);
        const nsfwResult = await analyzeMedia(ctx, targetMsg, config);
        if (nsfwResult.isViolation) {
            return nsfwResult;
        }
    }

    // Check AI Text (if text present) - Smart Report always analyzes regardless of ai_enabled
    const textContent = getTextContent(targetMsg);
    if (textContent && textContent.length > 5) {
        logger.info(`[smart-report] Checking text with AI: "${textContent.substring(0, 50)}..."`);
        const textResult = await analyzeText(textContent, ctx.chat.id, config);
        if (textResult.isViolation) {
            return textResult;
        }
    }

    return { isViolation: false, category: 'safe', reason: 'No violations detected' };
}

/**
 * Analyze last N messages from context buffer (no-reply mode)
 * @param {object} ctx - Telegram context
 * @param {object} config - Guild config
 * @param {number} limit - Number of messages to analyze
 * @returns {Promise<Array<{messageId: number, isViolation: boolean, category: string, reason: string}>>}
 */
async function analyzeContextMessages(ctx, config, limit = 10) {
    const chatId = ctx.chat.id;
    const buffer = getContext(chatId, limit);

    if (!buffer || buffer.length === 0) {
        logger.info(`[smart-report] No messages in context buffer for chat ${chatId}`);
        return [];
    }

    logger.info(`[smart-report] Analyzing ${buffer.length} context messages`);

    const results = [];

    for (const msg of buffer) {
        let result = { messageId: msg.messageId, isViolation: false, category: 'safe' };

        // Check text with AI - Smart Report always analyzes
        if (msg.text && msg.text.length > 10) {
            const textResult = await analyzeText(msg.text, chatId, config);
            if (textResult.isViolation) {
                result = { ...result, ...textResult };
                results.push(result);
                continue;
            }
        }

        // Note: For media in context, we can't easily re-analyze without file_id
        // This is a limitation - context mode is primarily for text analysis
        // Media analysis works best in reply mode

        results.push(result);
    }

    return results;
}

/**
 * Check if message has analyzable media
 */
function hasMedia(msg) {
    return !!(msg.photo || msg.video || msg.animation || msg.sticker || msg.document);
}

/**
 * Get text content from message
 */
function getTextContent(msg) {
    return msg.text || msg.caption || '';
}

/**
 * Analyze media using NSFW monitor
 * @param {object} ctx - Telegram context
 * @param {object} targetMsg - Target message with media
 * @param {object} config - Guild config
 */
async function analyzeMedia(ctx, targetMsg, config) {
    try {
        // Create a modified context that points to the target message
        const fakeCtx = {
            ...ctx,
            message: targetMsg,
            from: targetMsg.from,
            api: ctx.api,
            chat: ctx.chat
        };

        // Use NSFW monitor's analysis (but don't execute action, just analyze)
        const result = await nsfwLogic.analyzeMediaOnly(fakeCtx, config);

        if (result && result.isNsfw) {
            return {
                isViolation: true,
                category: result.category || 'nsfw',
                reason: result.reason || 'NSFW content detected',
                action: config.nsfw_action || 'delete',
                targetMessageId: targetMsg.message_id,
                targetUserId: targetMsg.from.id
            };
        }
    } catch (e) {
        logger.error(`[smart-report] Media analysis error: ${e.message}`);
    }

    return { isViolation: false };
}

/**
 * Analyze text using AI moderation
 * @param {string} text - Text to analyze
 * @param {number} chatId - Chat ID for context
 * @param {object} config - Guild config
 */
async function analyzeText(text, chatId, config) {
    try {
        const contextMessages = config.ai_context_aware ? getContext(chatId, 3) : [];
        // Use specific model for reports if set
        const reportModel = process.env.LM_STUDIO_MODEL_REPORTS || null;
        const result = await aiApi.processWithAI(text, contextMessages, config, reportModel);

        if (result.category !== 'safe' && result.confidence >= (config.ai_confidence_threshold || 0.75)) {
            // Use Smart Report's own category actions (report_action_*)
            // Note: 'hate' uses report_action_hate, not report_action_spam
            const actionKey = `report_action_${result.category}`;
            const action = config[actionKey] || 'report_only';

            return {
                isViolation: true,
                category: result.category,
                reason: result.reason || `AI detected: ${result.category}`,
                action: action,
                confidence: result.confidence
            };
        }
    } catch (e) {
        logger.error(`[smart-report] Text analysis error: ${e.message}`);
    }

    return { isViolation: false };
}

/**
 * Get the appropriate action for a violation
 */
function getActionForCategory(config, category, isNsfw = false) {
    if (isNsfw) {
        return config.nsfw_action || 'delete';
    }
    const actionKey = `ai_action_${category}`;
    return config[actionKey] || 'report_only';
}

module.exports = {
    analyzeTarget,
    analyzeContextMessages,
    hasMedia,
    getTextContent,
    getActionForCategory
};
