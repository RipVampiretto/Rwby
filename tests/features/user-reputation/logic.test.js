/**
 * Tests for user-reputation/logic.js
 */

const {
    TIER_THRESHOLDS,
    TIER_INFO,
    getUserTier,
    getLocalFlux,
    getGlobalFlux,
    modifyFlux
} = require('../../../src/features/user-reputation/logic');

// Mock database
const mockDb = {
    queryOne: jest.fn(),
    query: jest.fn()
};

describe('User Reputation Logic', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('TIER_THRESHOLDS', () => {
        it('should have correct tier thresholds', () => {
            expect(TIER_THRESHOLDS.TIER_0).toBe(0);
            expect(TIER_THRESHOLDS.TIER_1).toBe(100);
            expect(TIER_THRESHOLDS.TIER_2).toBe(300);
            expect(TIER_THRESHOLDS.TIER_3).toBe(500);
        });
    });

    describe('TIER_INFO', () => {
        it('should have info for all 4 tiers', () => {
            expect(TIER_INFO[0]).toBeDefined();
            expect(TIER_INFO[1]).toBeDefined();
            expect(TIER_INFO[2]).toBeDefined();
            expect(TIER_INFO[3]).toBeDefined();
        });

        it('should have emoji and flux range for each tier', () => {
            Object.values(TIER_INFO).forEach(tier => {
                expect(tier.emoji).toBeDefined();
                expect(tier.fluxRange).toBeDefined();
                expect(tier.restrictions).toBeInstanceOf(Array);
                expect(tier.bypasses).toBeInstanceOf(Array);
            });
        });

        it('Tier 0 should have no bypasses', () => {
            expect(TIER_INFO[0].bypasses).toHaveLength(0);
        });

        it('Tier 3 should have all_bypass', () => {
            expect(TIER_INFO[3].bypasses).toContain('all_bypass');
        });
    });

    describe('getUserTier()', () => {
        it('should return tier 0 for flux 0-99', async () => {
            mockDb.queryOne.mockResolvedValue({ local_flux: 0 });
            expect(await getUserTier(mockDb, 123, 456)).toBe(0);

            mockDb.queryOne.mockResolvedValue({ local_flux: 50 });
            expect(await getUserTier(mockDb, 123, 456)).toBe(0);

            mockDb.queryOne.mockResolvedValue({ local_flux: 99 });
            expect(await getUserTier(mockDb, 123, 456)).toBe(0);
        });

        it('should return tier 1 for flux 100-299', async () => {
            mockDb.queryOne.mockResolvedValue({ local_flux: 100 });
            expect(await getUserTier(mockDb, 123, 456)).toBe(1);

            mockDb.queryOne.mockResolvedValue({ local_flux: 200 });
            expect(await getUserTier(mockDb, 123, 456)).toBe(1);

            mockDb.queryOne.mockResolvedValue({ local_flux: 299 });
            expect(await getUserTier(mockDb, 123, 456)).toBe(1);
        });

        it('should return tier 2 for flux 300-499', async () => {
            mockDb.queryOne.mockResolvedValue({ local_flux: 300 });
            expect(await getUserTier(mockDb, 123, 456)).toBe(2);

            mockDb.queryOne.mockResolvedValue({ local_flux: 400 });
            expect(await getUserTier(mockDb, 123, 456)).toBe(2);

            mockDb.queryOne.mockResolvedValue({ local_flux: 499 });
            expect(await getUserTier(mockDb, 123, 456)).toBe(2);
        });

        it('should return tier 3 for flux 500+', async () => {
            mockDb.queryOne.mockResolvedValue({ local_flux: 500 });
            expect(await getUserTier(mockDb, 123, 456)).toBe(3);

            mockDb.queryOne.mockResolvedValue({ local_flux: 1000 });
            expect(await getUserTier(mockDb, 123, 456)).toBe(3);
        });

        it('should return tier 0 for non-existent user', async () => {
            mockDb.queryOne.mockResolvedValue(null);
            expect(await getUserTier(mockDb, 999, 456)).toBe(0);
        });
    });

    describe('getLocalFlux()', () => {
        it('should return flux from database', async () => {
            mockDb.queryOne.mockResolvedValue({ local_flux: 150 });
            const flux = await getLocalFlux(mockDb, 123, 456);
            expect(flux).toBe(150);
        });

        it('should return 0 for non-existent user', async () => {
            mockDb.queryOne.mockResolvedValue(null);
            const flux = await getLocalFlux(mockDb, 999, 456);
            expect(flux).toBe(0);
        });

        it('should call queryOne with correct parameters', async () => {
            mockDb.queryOne.mockResolvedValue({ local_flux: 100 });
            await getLocalFlux(mockDb, 123, 456);

            expect(mockDb.queryOne).toHaveBeenCalledWith(expect.stringContaining('user_trust_flux'), [123, 456]);
        });
    });

    describe('getGlobalFlux()', () => {
        it('should return global flux from database', async () => {
            mockDb.queryOne.mockResolvedValue({ global_flux: 500 });
            const flux = await getGlobalFlux(mockDb, 123);
            expect(flux).toBe(500);
        });

        it('should return 0 for non-existent user', async () => {
            mockDb.queryOne.mockResolvedValue(null);
            const flux = await getGlobalFlux(mockDb, 999);
            expect(flux).toBe(0);
        });
    });

    describe('modifyFlux()', () => {
        it('should call query with upsert SQL', async () => {
            mockDb.queryOne.mockResolvedValue({ local_flux: 100 });
            mockDb.query.mockResolvedValue({ rowCount: 1 });

            await modifyFlux(mockDb, 123, 456, 50, 'test');

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO user_trust_flux'),
                expect.any(Array)
            );
        });

        it('should clamp flux to max 1000', async () => {
            mockDb.queryOne.mockResolvedValue({ local_flux: 990 });
            mockDb.query.mockResolvedValue({ rowCount: 1 });

            await modifyFlux(mockDb, 123, 456, 100, 'test');

            // The newFlux should be clamped to 1000
            expect(mockDb.query).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([123, 456, 1000]));
        });

        it('should clamp flux to min -1000', async () => {
            mockDb.queryOne.mockResolvedValue({ local_flux: -990 });
            mockDb.query.mockResolvedValue({ rowCount: 1 });

            await modifyFlux(mockDb, 123, 456, -100, 'test');

            // The newFlux should be clamped to -1000
            expect(mockDb.query).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([123, 456, -1000]));
        });

        it('should handle positive delta', async () => {
            mockDb.queryOne.mockResolvedValue({ local_flux: 100 });
            mockDb.query.mockResolvedValue({ rowCount: 1 });

            await modifyFlux(mockDb, 123, 456, 50, 'bonus');

            expect(mockDb.query).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([123, 456, 150]));
        });

        it('should handle negative delta', async () => {
            mockDb.queryOne.mockResolvedValue({ local_flux: 100 });
            mockDb.query.mockResolvedValue({ rowCount: 1 });

            await modifyFlux(mockDb, 123, 456, -30, 'penalty');

            expect(mockDb.query).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([123, 456, 70]));
        });
    });
});
