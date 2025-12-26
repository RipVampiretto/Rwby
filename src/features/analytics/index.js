/**
 * @fileoverview Analytics module index
 * @module features/analytics
 */

const messageCounter = require('./message-counter');
const monthlyStats = require('./monthly-stats');

module.exports = {
    ...messageCounter,
    ...monthlyStats
};
