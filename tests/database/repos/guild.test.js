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
        it('should return config for guild from database', async () => {
            const { queryOne, query } = require('../../../src/database/connection');
            queryOne.mockResolvedValueOnce({
                guild_id: -100123,
                spam_enabled: false,
                ai_enabled: false
            });

            const config = await guildRepo.getGuildConfig(-100123);

            expect(config.guild_id).toBe(-100123);
            expect(queryOne).toHaveBeenCalled();
        });

        it('should create guild if not exists and return default config', async () => {
            const { queryOne, query } = require('../../../src/database/connection');
            queryOne
                .mockResolvedValueOnce(null) // First query - not found
                .mockResolvedValueOnce({ guild_id: -100123, spam_enabled: false });
            query.mockResolvedValue({ rowCount: 1 });

            const config = await guildRepo.getGuildConfig(-100123);

            expect(config.guild_id).toBe(-100123);
            expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO guild_config'), [-100123]);
        });

        it('should return default config on database error', async () => {
            const { queryOne } = require('../../../src/database/connection');
            queryOne.mockRejectedValue(new Error('DB Error'));

            const config = await guildRepo.getGuildConfig(-100123);

            expect(config.guild_id).toBe(-100123);
            expect(config.spam_enabled).toBe(0);
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

            const call = query.mock.calls[1]; // calls[1] is UPDATE, calls[0] is INSERT
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
