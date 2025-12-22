/**
 * Tests for anti-spam/detection.js
 */

const { checkSpamLimits } = require('../../../src/features/anti-spam/detection');

describe('Anti-Spam Detection', () => {
    describe('checkSpamLimits()', () => {
        describe('with medium sensitivity (default)', () => {
            const config = { spam_sensitivity: 'medium' };

            it('should not trigger for normal usage', () => {
                const stats = {
                    msg_count_10s: 2,
                    msg_count_60s: 5,
                    duplicate_count: 1
                };
                const result = checkSpamLimits(stats, config);
                expect(result.triggered).toBe(false);
            });

            it('should trigger burst for >5 messages in 10s', () => {
                const stats = {
                    msg_count_10s: 6,
                    msg_count_60s: 6,
                    duplicate_count: 0
                };
                const result = checkSpamLimits(stats, config);
                expect(result.triggered).toBe(true);
                expect(result.trigger).toContain('Burst');
                expect(result.action).toBe('delete');
            });

            it('should trigger flood for >10 messages in 60s', () => {
                const stats = {
                    msg_count_10s: 3,
                    msg_count_60s: 12,
                    duplicate_count: 0
                };
                const result = checkSpamLimits(stats, config);
                expect(result.triggered).toBe(true);
                expect(result.trigger).toContain('Flood');
            });

            it('should trigger repetition for >=3 duplicates', () => {
                const stats = {
                    msg_count_10s: 2,
                    msg_count_60s: 5,
                    duplicate_count: 3
                };
                const result = checkSpamLimits(stats, config);
                expect(result.triggered).toBe(true);
                expect(result.trigger).toContain('Repetition');
            });
        });

        describe('with high sensitivity', () => {
            const config = { spam_sensitivity: 'high' };

            it('should trigger burst for >3 messages in 10s', () => {
                const stats = {
                    msg_count_10s: 4,
                    msg_count_60s: 4,
                    duplicate_count: 0
                };
                const result = checkSpamLimits(stats, config);
                expect(result.triggered).toBe(true);
                expect(result.trigger).toContain('Burst');
            });

            it('should trigger flood for >5 messages in 60s', () => {
                const stats = {
                    msg_count_10s: 2,
                    msg_count_60s: 6,
                    duplicate_count: 0
                };
                const result = checkSpamLimits(stats, config);
                expect(result.triggered).toBe(true);
                expect(result.trigger).toContain('Flood');
            });

            it('should trigger repetition for >=2 duplicates', () => {
                const stats = {
                    msg_count_10s: 2,
                    msg_count_60s: 3,
                    duplicate_count: 2
                };
                const result = checkSpamLimits(stats, config);
                expect(result.triggered).toBe(true);
                expect(result.trigger).toContain('Repetition');
            });
        });

        describe('with low sensitivity', () => {
            const config = { spam_sensitivity: 'low' };

            it('should not trigger for 7 messages in 10s', () => {
                const stats = {
                    msg_count_10s: 7,
                    msg_count_60s: 7,
                    duplicate_count: 0
                };
                const result = checkSpamLimits(stats, config);
                expect(result.triggered).toBe(false);
            });

            it('should trigger burst for >8 messages in 10s', () => {
                const stats = {
                    msg_count_10s: 9,
                    msg_count_60s: 9,
                    duplicate_count: 0
                };
                const result = checkSpamLimits(stats, config);
                expect(result.triggered).toBe(true);
            });

            it('should not trigger for 4 duplicates', () => {
                const stats = {
                    msg_count_10s: 2,
                    msg_count_60s: 5,
                    duplicate_count: 4
                };
                const result = checkSpamLimits(stats, config);
                expect(result.triggered).toBe(false);
            });

            it('should trigger repetition for >=5 duplicates', () => {
                const stats = {
                    msg_count_10s: 2,
                    msg_count_60s: 5,
                    duplicate_count: 5
                };
                const result = checkSpamLimits(stats, config);
                expect(result.triggered).toBe(true);
            });
        });

        describe('with custom config overrides', () => {
            it('should use custom volume_limit_10s', () => {
                const config = {
                    spam_sensitivity: 'medium',
                    spam_volume_limit_10s: 2
                };
                const stats = {
                    msg_count_10s: 3,
                    msg_count_60s: 3,
                    duplicate_count: 0
                };
                const result = checkSpamLimits(stats, config);
                expect(result.triggered).toBe(true);
            });

            it('should use custom volume_limit_60s', () => {
                const config = {
                    spam_sensitivity: 'medium',
                    spam_volume_limit_60s: 3
                };
                const stats = {
                    msg_count_10s: 1,
                    msg_count_60s: 4,
                    duplicate_count: 0
                };
                const result = checkSpamLimits(stats, config);
                expect(result.triggered).toBe(true);
            });

            it('should use custom duplicate_limit', () => {
                const config = {
                    spam_sensitivity: 'medium',
                    spam_duplicate_limit: 1
                };
                const stats = {
                    msg_count_10s: 1,
                    msg_count_60s: 2,
                    duplicate_count: 1
                };
                const result = checkSpamLimits(stats, config);
                expect(result.triggered).toBe(true);
            });
        });

        describe('action selection', () => {
            it('should use spam_action_volume for volume triggers', () => {
                const config = {
                    spam_sensitivity: 'medium',
                    spam_action_volume: 'ban'
                };
                const stats = {
                    msg_count_10s: 10,
                    msg_count_60s: 10,
                    duplicate_count: 0
                };
                const result = checkSpamLimits(stats, config);
                expect(result.action).toBe('ban');
            });

            it('should use spam_action_repetition for repetition triggers', () => {
                const config = {
                    spam_sensitivity: 'medium',
                    spam_action_repetition: 'mute'
                };
                const stats = {
                    msg_count_10s: 2,
                    msg_count_60s: 5,
                    duplicate_count: 5
                };
                const result = checkSpamLimits(stats, config);
                expect(result.action).toBe('mute');
            });

            it('should default to delete action', () => {
                const config = { spam_sensitivity: 'medium' };
                const stats = {
                    msg_count_10s: 10,
                    msg_count_60s: 10,
                    duplicate_count: 0
                };
                const result = checkSpamLimits(stats, config);
                expect(result.action).toBe('delete');
            });
        });

        describe('edge cases', () => {
            it('should handle missing sensitivity (default to medium)', () => {
                const config = {};
                const stats = {
                    msg_count_10s: 6,
                    msg_count_60s: 6,
                    duplicate_count: 0
                };
                const result = checkSpamLimits(stats, config);
                expect(result.triggered).toBe(true);
            });

            it('should handle zero stats', () => {
                const config = { spam_sensitivity: 'medium' };
                const stats = {
                    msg_count_10s: 0,
                    msg_count_60s: 0,
                    duplicate_count: 0
                };
                const result = checkSpamLimits(stats, config);
                expect(result.triggered).toBe(false);
            });

            it('should prioritize burst over flood', () => {
                const config = { spam_sensitivity: 'medium' };
                const stats = {
                    msg_count_10s: 10, // triggers burst
                    msg_count_60s: 20, // also triggers flood
                    duplicate_count: 0
                };
                const result = checkSpamLimits(stats, config);
                expect(result.trigger).toContain('Burst');
            });
        });
    });
});
