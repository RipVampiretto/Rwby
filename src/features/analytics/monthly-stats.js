/**
 * @fileoverview Monthly statistics calculation and retrieval
 * @module features/analytics/monthly-stats
 *
 * @description
 * Calculates and stores monthly statistics for the bot.
 * Provides functions to retrieve stats with trend calculations.
 */

const logger = require('../../middlewares/logger');
const { getCurrentMonthYear } = require('./message-counter');

// Thresholds for "active" status
const ACTIVE_USER_THRESHOLD = 30; // messages
const ACTIVE_GUILD_THRESHOLD = 200; // messages per month

/**
 * Calculate monthly statistics for a given month
 * @param {object} db - Database instance
 * @param {string} monthYear - Month in YYYY-MM format
 * @returns {Promise<object>} Calculated stats
 */
async function calculateMonthlyStats(db, monthYear) {
    try {
        // Parse month boundaries
        const [year, month] = monthYear.split('-').map(Number);
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);
        const startISO = startDate.toISOString();
        const endISO = endDate.toISOString();

        // Previous month for comparison
        const prevMonth = month === 1 ? 12 : month - 1;
        const prevYear = month === 1 ? year - 1 : year;
        const prevMonthYear = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

        // New users this month
        const newUsersResult = await db.queryOne(
            `
            SELECT COUNT(*) as count FROM users 
            WHERE first_seen >= $1 AND first_seen <= $2
        `,
            [startISO, endISO]
        );
        const newUsers = parseInt(newUsersResult?.count || 0);

        // Active users (≥30 messages total)
        const activeUsersResult = await db.queryOne(
            `
            SELECT COUNT(*) as count FROM user_message_counts 
            WHERE message_count >= $1
        `,
            [ACTIVE_USER_THRESHOLD]
        );
        const activeUsers = parseInt(activeUsersResult?.count || 0);

        // New guilds this month
        const newGuildsResult = await db.queryOne(
            `
            SELECT COUNT(*) as count FROM guild_config 
            WHERE created_at >= $1 AND created_at <= $2
        `,
            [startISO, endISO]
        );
        const newGuilds = parseInt(newGuildsResult?.count || 0);

        // Lost guilds (guilds that existed last month but not this month)
        // For now, we track guilds without recent activity
        const lostGuildsResult = await db.queryOne(
            `
            SELECT COUNT(*) as count FROM guild_config gc
            WHERE NOT EXISTS (
                SELECT 1 FROM guild_message_counts gmc 
                WHERE gmc.guild_id = gc.guild_id AND gmc.month_year = $1
            )
            AND EXISTS (
                SELECT 1 FROM guild_message_counts gmc 
                WHERE gmc.guild_id = gc.guild_id AND gmc.month_year = $2
            )
        `,
            [monthYear, prevMonthYear]
        );
        const lostGuilds = parseInt(lostGuildsResult?.count || 0);

        // Active guilds (≥200 messages this month)
        const activeGuildsResult = await db.queryOne(
            `
            SELECT COUNT(*) as count FROM guild_message_counts 
            WHERE month_year = $1 AND message_count >= $2
        `,
            [monthYear, ACTIVE_GUILD_THRESHOLD]
        );
        const activeGuilds = parseInt(activeGuildsResult?.count || 0);

        // Global bans this month
        // Note: We need to track ban dates - for now use total if no date tracking
        const globalBansResult = await db.queryOne(`
            SELECT COUNT(*) as count FROM users WHERE is_banned_global = TRUE
        `);
        const globalBans = parseInt(globalBansResult?.count || 0);

        // Completed votes this month
        const completedVotesResult = await db.queryOne(
            `
            SELECT COUNT(*) as count FROM active_votes 
            WHERE status != 'active' 
            AND created_at >= $1 AND created_at <= $2
        `,
            [startISO, endISO]
        );
        const completedVotes = parseInt(completedVotesResult?.count || 0);

        // Build stats object
        const stats = {
            new_users: newUsers,
            active_users: activeUsers,
            new_guilds: newGuilds,
            lost_guilds: lostGuilds,
            active_guilds: activeGuilds,
            global_bans: globalBans,
            deleted_messages: 0, // TODO: Track deleted messages
            completed_votes: completedVotes
        };

        // Upsert into monthly_stats
        await db.query(
            `
            INSERT INTO monthly_stats (month_year, new_users, active_users, new_guilds, lost_guilds, active_guilds, global_bans, deleted_messages, completed_votes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (month_year) DO UPDATE SET
                new_users = $2,
                active_users = $3,
                new_guilds = $4,
                lost_guilds = $5,
                active_guilds = $6,
                global_bans = $7,
                deleted_messages = $8,
                completed_votes = $9,
                created_at = NOW()
        `,
            [
                monthYear,
                stats.new_users,
                stats.active_users,
                stats.new_guilds,
                stats.lost_guilds,
                stats.active_guilds,
                stats.global_bans,
                stats.deleted_messages,
                stats.completed_votes
            ]
        );

        logger.info(`[analytics] Calculated stats for ${monthYear}`);
        return stats;
    } catch (e) {
        logger.error(`[analytics] calculateMonthlyStats error: ${e.message}`);
        return null;
    }
}

/**
 * Get monthly statistics (from cache or calculate)
 * @param {object} db - Database instance
 * @param {string} monthYear - Month in YYYY-MM format
 * @param {boolean} forceRecalculate - Force recalculation
 * @returns {Promise<object|null>} Stats object or null
 */
async function getMonthlyStats(db, monthYear, forceRecalculate = false) {
    try {
        // Check if current month - always recalculate current month
        const currentMonth = getCurrentMonthYear();
        const isCurrentMonth = monthYear === currentMonth;

        if (!forceRecalculate && !isCurrentMonth) {
            // Try to get cached stats
            const cached = await db.queryOne('SELECT * FROM monthly_stats WHERE month_year = $1', [monthYear]);
            if (cached) {
                return cached;
            }
        }

        // Calculate (or recalculate for current month)
        return await calculateMonthlyStats(db, monthYear);
    } catch (e) {
        logger.error(`[analytics] getMonthlyStats error: ${e.message}`);
        return null;
    }
}

/**
 * Get list of months with available data
 * @param {object} db - Database instance
 * @returns {Promise<string[]>} Array of month-year strings
 */
async function getAvailableMonths(db) {
    try {
        const result = await db.queryAll(`
            SELECT DISTINCT month_year FROM guild_message_counts
            UNION
            SELECT month_year FROM monthly_stats
            ORDER BY month_year DESC
        `);

        // Always include current month
        const currentMonth = getCurrentMonthYear();
        const months = result.map(r => r.month_year);
        if (!months.includes(currentMonth)) {
            months.unshift(currentMonth);
        }

        return months;
    } catch (e) {
        logger.error(`[analytics] getAvailableMonths error: ${e.message}`);
        return [getCurrentMonthYear()];
    }
}

/**
 * Calculate trend percentage and emoji
 * @param {number} current - Current value
 * @param {number} previous - Previous value
 * @returns {object} { percent: number, emoji: string, text: string }
 */
function calculateTrend(current, previous) {
    if (previous === 0 || previous === null || previous === undefined) {
        return { percent: 0, emoji: '🆕', text: 'nuovo' };
    }

    const diff = current - previous;
    const percent = Math.round((diff / previous) * 100);

    let emoji, text;
    if (percent > 0) {
        emoji = '📈';
        text = `+${percent}%`;
    } else if (percent < 0) {
        emoji = '📉';
        text = `${percent}%`;
    } else {
        emoji = '➡️';
        text = '0%';
    }

    return { percent, emoji, text };
}

/**
 * Get previous month string
 * @param {string} monthYear - Current month in YYYY-MM format
 * @returns {string} Previous month in YYYY-MM format
 */
function getPreviousMonth(monthYear) {
    const [year, month] = monthYear.split('-').map(Number);
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

/**
 * Get next month string
 * @param {string} monthYear - Current month in YYYY-MM format
 * @returns {string} Next month in YYYY-MM format
 */
function getNextMonth(monthYear) {
    const [year, month] = monthYear.split('-').map(Number);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

/**
 * Format month-year for display
 * @param {string} monthYear - Month in YYYY-MM format
 * @returns {string} Formatted string e.g. "Dicembre 2024"
 */
function formatMonthYear(monthYear) {
    const [year, month] = monthYear.split('-').map(Number);
    const months = [
        'Gennaio',
        'Febbraio',
        'Marzo',
        'Aprile',
        'Maggio',
        'Giugno',
        'Luglio',
        'Agosto',
        'Settembre',
        'Ottobre',
        'Novembre',
        'Dicembre'
    ];
    return `${months[month - 1]} ${year}`;
}

module.exports = {
    calculateMonthlyStats,
    getMonthlyStats,
    getAvailableMonths,
    calculateTrend,
    getPreviousMonth,
    getNextMonth,
    formatMonthYear,
    getCurrentMonthYear,
    ACTIVE_USER_THRESHOLD,
    ACTIVE_GUILD_THRESHOLD
};
