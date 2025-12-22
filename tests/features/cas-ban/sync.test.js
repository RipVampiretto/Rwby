/**
 * Tests for cas-ban/sync.js
 * Note: downloadCsv is skipped as it makes real HTTP requests
 */

// Mock https module
jest.mock('https', () => ({
    get: jest.fn()
}));

describe('CAS Ban Sync', () => {
    let sync;
    let mockDb;

    beforeEach(() => {
        jest.resetModules();
        mockDb = {
            query: jest.fn().mockResolvedValue({ rowCount: 1 }),
            queryOne: jest.fn(),
            queryAll: jest.fn().mockResolvedValue([])
        };

        sync = require('../../../src/features/cas-ban/sync');
        sync.init(mockDb, null);
    });

    // parseCsv is internal, test via syncCasBans behavior
    describe('syncCasBans()', () => {
        it('should return success with no new bans message when no new users', async () => {
            // Mock: database returns high ID (nothing new in CSV)
            mockDb.queryOne.mockResolvedValue({ max_id: 999999999 });

            // Mock https to return empty CSV
            const https = require('https');
            const mockResponse = {
                statusCode: 200,
                on: jest.fn((event, cb) => {
                    if (event === 'data') cb(Buffer.from('user_id,offenses\n'));
                    if (event === 'end') cb();
                    return mockResponse;
                })
            };
            https.get.mockImplementation((url, cb) => {
                cb(mockResponse);
                return { on: jest.fn() };
            });

            const result = await sync.syncCasBans();

            expect(result.success).toBe(true);
            expect(result.newBans).toBe(0);
        });
    });
});
