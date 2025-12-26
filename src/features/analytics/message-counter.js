/**
 * @fileoverview Message counting middleware for analytics
 * @module features/analytics/message-counter
 *
 * @description
 * Tracks message counts per user and per guild/month for analytics.
 * Used to determine "active users" (≥30 msgs) and "active guilds" (≥200 msgs/month).
 */

const logger = require('../../middlewares/logger');

/**
 * Get current month-year string in YYYY-MM format
 * @returns {string} e.g. "2024-12"
 */
function getCurrentMonthYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

/**
 * Middleware to count messages for analytics
 * @param {object} db - Database instance
 * @returns {Function} Grammy middleware
 */
function createMessageCounter(db) {
    return async (ctx, next) => {
        // Only count messages in groups/supergroups
        if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
            return next();
        }

        // Only count actual messages (not edits, callbacks, etc.)
        if (!ctx.message) {
            return next();
        }

        const userId = ctx.from?.id;
        const guildId = ctx.chat?.id;

        if (!userId || !guildId) {
            return next();
        }

        const monthYear = getCurrentMonthYear();

        // Fire and forget - don't block message processing
        setImmediate(async () => {
            try {
                // Increment user message count
                await db.query(
                    `
                    INSERT INTO user_message_counts (user_id, message_count, last_updated)
                    VALUES ($1, 1, NOW())
                    ON CONFLICT (user_id) DO UPDATE SET 
                        message_count = user_message_counts.message_count + 1,
                        last_updated = NOW()
                `,
                    [userId]
                );

                // Increment guild monthly message count
                await db.query(
                    `
                    INSERT INTO guild_message_counts (guild_id, month_year, message_count)
                    VALUES ($1, $2, 1)
                    ON CONFLICT (guild_id, month_year) DO UPDATE SET 
                        message_count = guild_message_counts.message_count + 1
                `,
                    [guildId, monthYear]
                );
            } catch (e) {
                logger.error(`[analytics] Message count error: ${e.message}`);
            }
        });

        return next();
    };
}

module.exports = {
    createMessageCounter,
    getCurrentMonthYear
};
