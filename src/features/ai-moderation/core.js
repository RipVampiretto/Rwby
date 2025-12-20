const logger = require('../../middlewares/logger');
const { safeDelete, safeBan } = require('../../utils/error-handlers');
const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');
const { processWithAI } = require('./api');
const { getContext } = require('./context');

let db = null;

function init(database) {
    db = database;
}

/**
 * Check if user is admin
 */
async function isUserAdmin(ctx) {
    try {
        const member = await ctx.getChatMember(ctx.from.id);
        return ['creator', 'administrator'].includes(member.status);
    } catch (e) {
        return false;
    }
}

/**
 * Analyze a message using AI as a last resort filter.
 * 
 * @param {Context} ctx - Telegram context
 * @returns {Promise<{triggered: boolean, result: object|null}>}
 */
async function analyzeMessage(ctx) {
    if (!db) {
        logger.warn('[ai-moderation] analyzeMessage called but module not initialized');
        return { triggered: false, result: null };
    }

    const config = db.getGuildConfig(ctx.chat.id);

    // Check if enabled
    if (!config.ai_enabled) {
        return { triggered: false, result: null };
    }

    // Check tier bypass
    const tierBypass = config.ai_tier_bypass ?? 2;
    if (tierBypass !== -1 && ctx.userTier !== undefined && ctx.userTier >= tierBypass) {
        return { triggered: false, result: null };
    }

    // Check admin bypass
    if (await isUserAdmin(ctx)) {
        return { triggered: false, result: null };
    }

    // Check minimum length
    const text = ctx.message?.text;
    if (!text || text.length < 10) {
        return { triggered: false, result: null };
    }

    // Get context messages if enabled
    let contextMessages = [];
    if (config.ai_context_aware) {
        const numContext = config.ai_context_messages || 3;
        contextMessages = getContext(ctx.chat.id, numContext);
    }

    // Process with AI
    try {
        const result = await processWithAI(text, contextMessages, config);

        if (result.category !== 'safe' && result.confidence >= (config.ai_confidence_threshold || 0.75)) {
            await handleViolation(ctx, config, result);
            return { triggered: true, result: result };
        }

        return { triggered: false, result: result };
    } catch (e) {
        logger.warn(`[ai-moderation] AI Check failed: ${e.message}`);
        return { triggered: false, result: null };
    }
}

async function handleViolation(ctx, config, result) {
    const category = result.category; // scam, nsfw, spam
    const actionKey = `ai_action_${category}`;
    const action = config[actionKey] || 'report_only';

    const user = ctx.from;
    const trigger = `AI: ${category.toUpperCase()} (${Math.round(result.confidence * 100)}%)`;

    // Determine eventType based on action
    const eventType = action === 'ban' ? 'ai_ban' : 'ai_delete';

    // Log intent
    const logParams = {
        guildId: ctx.chat.id,
        eventType: eventType,
        targetUser: user,
        reason: `${trigger} - ${result.reason}`,
        isGlobal: (action === 'ban')
    };

    if (action === 'delete') {
        await safeDelete(ctx, 'ai-moderation');
        if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
    }
    else if (action === 'ban') {
        await safeDelete(ctx, 'ai-moderation');
        const banned = await safeBan(ctx, user.id, 'ai-moderation');

        if (banned) {
            await ctx.reply(`🚫 **BANNED (AI)**\nReason: ${category}`);
            userReputation.modifyFlux(user.id, ctx.chat.id, -100, `ai_ban_${category}`);

            if (superAdmin.forwardBanToParliament) {
                superAdmin.forwardBanToParliament({
                    user: user,
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: `${trigger}\nExplanation: ${result.reason}`,
                    evidence: ctx.message.text,
                    flux: userReputation.getLocalFlux(user.id, ctx.chat.id)
                });
            }

            logParams.eventType = 'ban';
            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
        }
    }
    else { // report_only
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'AI-Moderation',
            user: user,
            reason: `${trigger}\nReason: ${result.reason}`,
            messageId: ctx.message.message_id,
            content: ctx.message.text
        });
    }
}

module.exports = {
    init,
    analyzeMessage
};
