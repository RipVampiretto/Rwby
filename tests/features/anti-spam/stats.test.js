/**
 * Tests for anti-spam/stats.js
 */

describe('Anti-Spam Stats', () => {
    let stats;
    let mockDb;

    beforeEach(() => {
        jest.resetModules();
        mockDb = {
            query: jest.fn().mockResolvedValue({ rowCount: 1 }),
            queryOne: jest.fn()
        };
        stats = require('../../../src/features/anti-spam/stats');
        stats.init(mockDb);
    });

    describe('getStats()', () => {
        it('should return stats from database', async () => {
            const dbStats = {
                user_id: 123,
                guild_id: -100,
                msg_count_60s: 5,
                msg_count_10s: 2,
                duplicate_count: 1
            };
            mockDb.queryOne.mockResolvedValue(dbStats);

            const result = await stats.getStats(123, -100);

            expect(result).toEqual(dbStats);
            expect(mockDb.queryOne).toHaveBeenCalledWith(
                expect.stringContaining('user_active_stats'),
                [123, -100]
            );
        });

        it('should return default stats for new user', async () => {
            mockDb.queryOne.mockResolvedValue(null);

            const result = await stats.getStats(123, -100);

            expect(result.user_id).toBe(123);
            expect(result.guild_id).toBe(-100);
            expect(result.msg_count_60s).toBe(0);
            expect(result.msg_count_10s).toBe(0);
            expect(result.duplicate_count).toBe(0);
        });

        it('should return null without db', async () => {
            jest.resetModules();
            const freshStats = require('../../../src/features/anti-spam/stats');
            // Don't call init

            const result = await freshStats.getStats(123, -100);
            expect(result).toBeNull();
        });
    });

    describe('updateStats()', () => {
        it('should upsert stats to database', async () => {
            const userStats = {
                user_id: 123,
                guild_id: -100,
                msg_count_60s: 5,
                msg_count_10s: 2,
                last_msg_content: 'Hello',
                last_msg_ts: '2024-01-01T00:00:00Z',
                duplicate_count: 1
            };

            await stats.updateStats(userStats);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO user_active_stats'),
                expect.arrayContaining([123, -100, 5, 2, 'Hello'])
            );
        });

        it('should use current timestamp if last_msg_ts is null', async () => {
            const userStats = {
                user_id: 123,
                guild_id: -100,
                msg_count_60s: 1,
                msg_count_10s: 1,
                last_msg_content: 'Test',
                last_msg_ts: null,
                duplicate_count: 0
            };

            await stats.updateStats(userStats);

            // Should have been called with a date string (ISO format)
            const callArgs = mockDb.query.mock.calls[0][1];
            expect(callArgs[5]).toBeDefined();
            expect(typeof callArgs[5]).toBe('string');
        });

        it('should not throw without db', async () => {
            jest.resetModules();
            const freshStats = require('../../../src/features/anti-spam/stats');
            // Don't call init

            await expect(freshStats.updateStats({
                user_id: 123,
                guild_id: -100,
                msg_count_60s: 0,
                msg_count_10s: 0,
                duplicate_count: 0
            })).resolves.not.toThrow();
        });
    });
});
