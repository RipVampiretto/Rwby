const logger = require('../../middlewares/logger');
const envConfig = require('../../config/env');
const lmLogger = require('../../utils/lm-studio-logger');
const lmClient = require('../../utils/lm-studio-client');

let db = null;

function init(database) {
    db = database;
    logger.info(`[MentionFilter] Module initialized`);
}

/**
 * Extract @username mentions from a message
 * @param {Object} message - Telegram message object
 * @returns {Array} - Array of { username, userId (if available) }
 */
function extractMentions(message) {
    const mentions = [];
    const text = message.text || message.caption || '';
    const entities = message.entities || message.caption_entities || [];

    for (const entity of entities) {
        if (entity.type === 'mention') {
            // @username mention - extract from text
            const username = text.substring(entity.offset + 1, entity.offset + entity.length); // +1 to skip @
            mentions.push({ username: username.toLowerCase(), userId: null });
            logger.debug(`[MentionFilter] Found @mention: ${username}`);
        } else if (entity.type === 'text_mention') {
            // text_mention includes user object with id
            mentions.push({
                username: entity.user.username ? entity.user.username.toLowerCase() : null,
                userId: entity.user.id
            });
            logger.debug(`[MentionFilter] Found text_mention: userId=${entity.user.id}`);
        }
    }

    if (mentions.length > 0) {
        logger.debug(`[MentionFilter] Total mentions extracted: ${mentions.length}`);
    }

    return mentions;
}

/**
 * Check if a user exists in our database by username
 * @param {string} username - Username without @
 * @returns {Object|null} - User object or null
 */
async function findUserByUsername(username) {
    if (!db) return null;

    try {
        return await db.queryOne(
            'SELECT user_id, username, first_name, is_banned_global FROM users WHERE LOWER(username) = LOWER($1)',
            [username]
        );
    } catch (e) {
        logger.error(`[mention-filter] Error finding user by username: ${e.message}`);
        return null;
    }
}

/**
 * Check if a user is a member of the specified chat
 * @param {Object} ctx - Telegram context
 * @param {number} userId - User ID to check
 * @returns {boolean} - True if member, false otherwise
 */
async function isUserInChat(ctx, userId) {
    try {
        const member = await ctx.api.getChatMember(ctx.chat.id, userId);
        // member, administrator, creator = in chat
        // left, kicked, restricted (with is_member=false) = not in chat
        return (
            ['member', 'administrator', 'creator'].includes(member.status) ||
            (member.status === 'restricted' && member.is_member)
        );
    } catch (e) {
        // User not found or other error - treat as not in chat
        logger.debug(`[mention-filter] getChatMember error for ${userId}: ${e.message}`);
        return false;
    }
}

/**
 * Call LM Studio to classify a message as scam or safe
 * @param {string} messageText - The full message text
 * @param {string} mentionedUsername - The mentioned username
 * @returns {Object} - { isScam: boolean, confidence: number, reason: string }
 */
async function classifyWithAI(messageText, mentionedUsername) {
    const model = envConfig.LM_STUDIO.scamModel;

    logger.debug(`[mention-filter] Calling AI for scam classification - model: ${model}`);

    const systemPrompt = `You are a scam detection assistant for Telegram group moderation.

Your task is to analyze messages that mention external users (@username) and determine if the message is likely a scam or recruitment fraud.

COMMON SCAM PATTERNS:
- Recruitment offers with vague job descriptions
- Promises of "good income" or "easy money"
- Requests to DM/PM someone for "details" or "opportunities"
- Crypto/investment schemes
- Limited-time offers creating urgency
- Age requirements for vague opportunities (e.g., "18+ only")
- Requests to contact external users not in the group
- MLM/pyramid scheme indicators
- Romance scams or "looking for partners"
- Fake giveaways or contests

SAFE PATTERNS:
- Normal conversations mentioning friends/colleagues
- Technical discussions mentioning developers/maintainers
- Replies referring to previous messages
- Group announcements mentioning staff/admins
- Clearly benign social interactions

Respond with a JSON object ONLY:
{
  "classification": "scam" or "safe",
  "confidence": 0.0 to 1.0,
  "reason": "brief explanation"
}`;

    const userPrompt = `Analyze this message that mentions @${mentionedUsername}:

"${messageText}"

Classify as scam or safe. Respond ONLY with the JSON object.`;

    try {
        const result = await lmClient.textChat(model, [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], {
            temperature: 0.1,
            maxTokens: 200
        });

        const content = result.content || '';

        // Parse JSON from response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            logger.warn(`[mention-filter] AI response not valid JSON: ${content}`);
            return { isScam: false, confidence: 0, reason: 'AI response parsing failed' };
        }

        const parsed = JSON.parse(jsonMatch[0]);

        logger.info(
            `[mention-filter] AI classification: ${parsed.classification} (${Math.round(parsed.confidence * 100)}%) - ${parsed.reason}`
        );

        return {
            isScam: parsed.classification === 'scam',
            confidence: parsed.confidence || 0.5,
            reason: parsed.reason || 'No reason provided',
            _lmLogSaved: (() => {
                // Save conversation to LM Studio
                lmLogger.saveTextConversation(null, systemPrompt, userPrompt, content, {
                    totalTimeSec: result.stats?.totalTimeSec || 0
                }, {
                    source: 'mention-filter',
                    model: model,
                    mentionedUsername
                });
                return true;
            })()
        };
    } catch (e) {
        logger.error(`[mention-filter] AI classification error: ${e.message}`);
        // On error, default to safe (don't block)
        return { isScam: false, confidence: 0, reason: 'AI service unavailable' };
    }
}

/**
 * Main scan function - check message for suspicious external mentions
 * @param {Object} ctx - Telegram context
 * @param {Object} config - Guild config
 * @returns {Object|null} - Verdict { type, username, userId, aiResult } or null if safe
 */
async function scanMessage(ctx, config) {
    const message = ctx.message;
    const mentions = extractMentions(message);

    if (mentions.length === 0) {
        logger.debug(`[MentionFilter] No mentions in message`, ctx);
        return null;
    }

    logger.info(`[MentionFilter] Scanning message with ${mentions.length} mentions`, ctx);

    const messageText = message.text || message.caption || '';
    const senderId = ctx.from?.id;

    for (const mention of mentions) {
        // Skip self-mentions
        if (mention.userId && mention.userId === senderId) continue;

        let userId = mention.userId;
        let isExternal = false;
        let isGbanned = false;

        // Try to find user in our database
        if (!userId && mention.username) {
            const dbUser = await findUserByUsername(mention.username);
            if (dbUser) {
                userId = dbUser.user_id;
                isGbanned = dbUser.is_banned_global;
            }
        }

        // Check if user is globally banned
        if (userId && !isGbanned) {
            const dbUser = await db.queryOne('SELECT is_banned_global FROM users WHERE user_id = $1', [userId]);
            if (dbUser?.is_banned_global) {
                isGbanned = true;
            }
        }

        // If globally banned, immediate flag
        if (isGbanned) {
            logger.warn(`[mention-filter] Mentioned user @${mention.username || userId} is globally banned!`);
            return {
                type: 'gbanned',
                username: mention.username,
                userId: userId,
                aiResult: { isScam: true, confidence: 1.0, reason: 'User is globally banned' }
            };
        }

        // Check if user exists in DB
        if (!userId) {
            // User NOT in our database - external unknown user
            isExternal = true;
            logger.debug(`[mention-filter] @${mention.username} not found in DB - treating as external`);
        } else {
            // User in DB - check if they're in THIS chat
            const inChat = await isUserInChat(ctx, userId);
            if (!inChat) {
                isExternal = true;
                logger.debug(`[mention-filter] @${mention.username} (${userId}) not in current chat`);
            }
        }

        // If external mention found, analyze with AI
        if (isExternal) {
            logger.info(`[mention-filter] External mention detected: @${mention.username} - sending to AI`);

            const aiResult = await classifyWithAI(messageText, mention.username);

            if (aiResult.isScam && aiResult.confidence >= 0.6) {
                return {
                    type: 'scam',
                    username: mention.username,
                    userId: userId,
                    aiResult: aiResult
                };
            }

            // Log for monitoring even if classified as safe
            if (aiResult.confidence > 0) {
                logger.debug(
                    `[MentionFilter] External @${mention.username} classified as safe (conf: ${aiResult.confidence})`, ctx
                );
            }
        }
    }

    logger.debug(`[MentionFilter] All mentions passed checks`, ctx);
    return null;
}

module.exports = {
    init,
    extractMentions,
    findUserByUsername,
    isUserInChat,
    classifyWithAI,
    scanMessage
};
