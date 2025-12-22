/**
 * Tests for database/repos/guild.js
 */

// Need to mock connection module before requiring guild
jest.mock('../../../src/database/connection', () => ({
    query: jest.fn(),
    queryOne: jest.fn(),
    queryAll: jest.fn()
}));

const { query, queryOne, queryAll } = require('../../../src/database/connection');

describe('Guild Repository', () => {
    let guildRepo;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();

        // Re-mock after resetModules
        jest.mock('../../../src/database/connection', () => ({
            query: jest.fn(),
            queryOne: jest.fn(),
            queryAll: jest.fn().mockResolvedValue([])
        }));

        guildRepo = require('../../../src/database/repos/guild');
    });

    describe('getGuildConfig()', () => {
        it('should return default config for new guild', () => {
            const config = guildRepo.getGuildConfig(-100123);

            expect(config.guild_id).toBe(-100123);
            expect(config.spam_enabled).toBe(0);
            expect(config.ai_enabled).toBe(0);
        });

        it('should return same reference for same guild (cached)', () => {
            const config1 = guildRepo.getGuildConfig(-100123);
            const config2 = guildRepo.getGuildConfig(-100123);

            expect(config1).toBe(config2);
        });

        it('should handle string guild ID', () => {
            const config1 = guildRepo.getGuildConfig('-100123');
            const config2 = guildRepo.getGuildConfig(-100123);

            // Should be same cached object
            expect(config1).toBe(config2);
        });
    });

    describe('fetchGuildConfig()', () => {
        it('should query database directly', async () => {
            const { queryOne, query } = require('../../../src/database/connection');
            queryOne.mockResolvedValue({
                guild_id: -100123,
                spam_enabled: 1,
                ai_enabled: 1
            });

            const config = await guildRepo.fetchGuildConfig(-100123);

            expect(config.spam_enabled).toBe(1);
            expect(queryOne).toHaveBeenCalled();
        });

        it('should create guild if not exists', async () => {
            const { queryOne, query } = require('../../../src/database/connection');
            queryOne
                .mockResolvedValueOnce(null) // First query - not found
                .mockResolvedValueOnce({ guild_id: -100123 }); // After insert
            query.mockResolvedValue({ rowCount: 1 });

            await guildRepo.fetchGuildConfig(-100123);

            expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO guild_config'), [-100123]);
        });

        it('should return default on DB error', async () => {
            const { queryOne } = require('../../../src/database/connection');
            queryOne.mockRejectedValue(new Error('DB Error'));

            const config = await guildRepo.fetchGuildConfig(-100123);

            expect(config.guild_id).toBe(-100123);
            expect(config.spam_enabled).toBe(0);
        });
    });

    describe('updateGuildConfig()', () => {
        it('should update valid columns only', async () => {
            const { query } = require('../../../src/database/connection');
            query.mockResolvedValue({ rowCount: 1 });

            await guildRepo.updateGuildConfig(-100123, {
                spam_enabled: 1,
                invalid_column: 'bad',
                ai_enabled: 1
            });

            const call = query.mock.calls[0];
            expect(call[0]).toContain('spam_enabled');
            expect(call[0]).toContain('ai_enabled');
            expect(call[0]).not.toContain('invalid_column');
        });

        it('should not execute query for all invalid columns', async () => {
            const { query } = require('../../../src/database/connection');

            await guildRepo.updateGuildConfig(-100123, {
                bad_column: 'value'
            });

            expect(query).not.toHaveBeenCalled();
        });

        it('should JSON stringify objects', async () => {
            const { query } = require('../../../src/database/connection');
            query.mockResolvedValue({ rowCount: 1 });

            await guildRepo.updateGuildConfig(-100123, {
                allowed_languages: ['en', 'it']
            });

            expect(query).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['["en","it"]']));
        });
    });

    describe('upsertGuild()', () => {
        it('should insert or update guild name', async () => {
            const { query } = require('../../../src/database/connection');
            query.mockResolvedValue({ rowCount: 1 });

            await guildRepo.upsertGuild({ id: -100123, title: 'Test Group' });

            expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO guild_config'), [
                -100123,
                'Test Group'
            ]);
        });

        it('should skip if no title', async () => {
            const { query } = require('../../../src/database/connection');

            await guildRepo.upsertGuild({ id: -100123 });

            expect(query).not.toHaveBeenCalled();
        });
    });
});
