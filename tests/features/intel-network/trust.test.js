/**
 * Tests for intel-network/trust.js
 */

describe('Intel Network Trust', () => {
    let trust;
    let mockDb;

    beforeEach(() => {
        jest.resetModules();
        mockDb = {
            query: jest.fn().mockResolvedValue({ rowCount: 1 }),
            queryOne: jest.fn()
        };
        trust = require('../../../src/features/intel-network/trust');
        trust.init(mockDb);
    });

    describe('getGuildTrust()', () => {
        it('should return existing trust record', async () => {
            const trustRecord = {
                guild_id: -100123,
                trust_score: 50,
                last_sync: new Date().toISOString()
            };
            mockDb.queryOne.mockResolvedValue(trustRecord);

            const result = await trust.getGuildTrust(-100123);

            expect(result).toEqual(trustRecord);
            expect(mockDb.queryOne).toHaveBeenCalledWith(expect.stringContaining('guild_trust'), [-100123]);
        });

        it('should create trust record if not exists', async () => {
            const trustRecord = { guild_id: -100123, trust_score: 0 };
            mockDb.queryOne
                .mockResolvedValueOnce(null) // First call - not found
                .mockResolvedValueOnce(trustRecord); // After insert

            const result = await trust.getGuildTrust(-100123);

            expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO guild_trust'), [-100123]);
            expect(result).toEqual(trustRecord);
        });

        it('should return null without db', async () => {
            jest.resetModules();
            const freshTrust = require('../../../src/features/intel-network/trust');
            // Don't call init

            const result = await freshTrust.getGuildTrust(-100123);
            expect(result).toBeNull();
        });
    });
});
