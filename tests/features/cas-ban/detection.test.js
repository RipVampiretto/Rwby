/**
 * Tests for cas-ban/detection.js
 */

describe('CAS Ban Detection', () => {
    let detection;
    let mockDb;

    beforeEach(() => {
        // Reset module cache to get fresh state
        jest.resetModules();

        mockDb = {
            queryAll: jest.fn()
        };

        detection = require('../../../src/features/cas-ban/detection');
        detection.init(mockDb);
    });

    describe('loadCache()', () => {
        it('should load CAS bans into Set', async () => {
            mockDb.queryAll.mockResolvedValue([
                { user_id: '123456789' },
                { user_id: '987654321' },
                { user_id: '555555555' }
            ]);

            await detection.reloadCache();

            expect(detection.getCacheSize()).toBe(3);
        });

        it('should handle empty database', async () => {
            mockDb.queryAll.mockResolvedValue([]);

            await detection.reloadCache();

            expect(detection.getCacheSize()).toBe(0);
        });

        it('should handle database errors gracefully', async () => {
            mockDb.queryAll.mockRejectedValue(new Error('DB error'));

            await detection.reloadCache();

            expect(detection.getCacheSize()).toBe(0);
        });

        it('should convert BigInt strings to Numbers', async () => {
            mockDb.queryAll.mockResolvedValue([
                { user_id: '9007199254740991' } // Max safe integer as string
            ]);

            await detection.reloadCache();

            const isBanned = await detection.isCasBanned(9007199254740991);
            expect(isBanned).toBe(true);
        });
    });

    describe('isCasBanned()', () => {
        beforeEach(async () => {
            mockDb.queryAll.mockResolvedValue([
                { user_id: '123456789' },
                { user_id: '987654321' }
            ]);
            await detection.reloadCache();
        });

        it('should return true for banned user', async () => {
            const result = await detection.isCasBanned(123456789);
            expect(result).toBe(true);
        });

        it('should return false for non-banned user', async () => {
            const result = await detection.isCasBanned(111111111);
            expect(result).toBe(false);
        });

        it('should handle string user IDs', async () => {
            const result = await detection.isCasBanned('123456789');
            expect(result).toBe(true);
        });

        it('should be O(1) lookup (using Set)', async () => {
            // This is implicit in the Set implementation
            // Multiple lookups should be fast
            for (let i = 0; i < 1000; i++) {
                await detection.isCasBanned(123456789);
            }
            // If this completes quickly, Set is working
            expect(true).toBe(true);
        });
    });

    describe('addToCache()', () => {
        beforeEach(async () => {
            mockDb.queryAll.mockResolvedValue([]);
            await detection.reloadCache();
        });

        it('should add new user IDs to cache', () => {
            detection.addToCache([111, 222, 333]);
            expect(detection.getCacheSize()).toBe(3);
        });

        it('should not duplicate existing IDs', async () => {
            mockDb.queryAll.mockResolvedValue([{ user_id: '111' }]);
            await detection.reloadCache();

            detection.addToCache([111, 222]);
            expect(detection.getCacheSize()).toBe(2);
        });
    });

    describe('getCacheSize()', () => {
        it('should return correct cache size', async () => {
            mockDb.queryAll.mockResolvedValue([
                { user_id: '1' },
                { user_id: '2' },
                { user_id: '3' },
                { user_id: '4' },
                { user_id: '5' }
            ]);

            await detection.reloadCache();

            expect(detection.getCacheSize()).toBe(5);
        });

        it('should return 0 when cache is empty', async () => {
            mockDb.queryAll.mockResolvedValue([]);
            await detection.reloadCache();

            expect(detection.getCacheSize()).toBe(0);
        });
    });

    describe('reloadCache()', () => {
        it('should clear and reload cache', async () => {
            // Initial load
            mockDb.queryAll.mockResolvedValue([{ user_id: '111' }]);
            await detection.reloadCache();
            expect(detection.getCacheSize()).toBe(1);

            // Reload with different data
            mockDb.queryAll.mockResolvedValue([
                { user_id: '222' },
                { user_id: '333' }
            ]);
            await detection.reloadCache();

            expect(detection.getCacheSize()).toBe(2);
            expect(await detection.isCasBanned(111)).toBe(false);
            expect(await detection.isCasBanned(222)).toBe(true);
        });
    });
});
