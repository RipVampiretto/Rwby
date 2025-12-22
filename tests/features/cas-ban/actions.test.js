/**
 * Tests for cas-ban/actions.js
 */

// Mock dependencies
jest.mock('../../../src/utils/error-handlers', () => ({
    safeDelete: jest.fn().mockResolvedValue(true),
    safeBan: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../../src/features/admin-logger', () => ({
    getLogEvent: jest.fn().mockReturnValue(null)
}));

const { handleCasBan, processNewCasBans } = require('../../../src/features/cas-ban/actions');
const actions = require('../../../src/features/cas-ban/actions');
const errorHandlers = require('../../../src/utils/error-handlers');
const adminLogger = require('../../../src/features/admin-logger');

describe('CAS Ban Actions', () => {
    let mockDb;
    let mockBot;

    beforeEach(() => {
        jest.clearAllMocks();

        mockDb = {
            query: jest.fn().mockResolvedValue({ rowCount: 1 }),
            queryOne: jest.fn(),
            queryAll: jest.fn().mockResolvedValue([])
        };

        mockBot = {
            api: {
                banChatMember: jest.fn().mockResolvedValue(true),
                sendMessage: jest.fn().mockResolvedValue({ message_id: 1 })
            }
        };

        actions.init(mockDb, mockBot);
    });

    describe('handleCasBan()', () => {
        it('should delete message and ban user', async () => {
            const ctx = {
                from: { id: 123, first_name: 'Spammer' },
                chat: { id: -100123 }
            };

            await handleCasBan(ctx);

            expect(errorHandlers.safeDelete).toHaveBeenCalledWith(ctx, 'cas-ban');
            expect(errorHandlers.safeBan).toHaveBeenCalledWith(ctx, 123, 'cas-ban');
        });

        it('should log event if admin logger available', async () => {
            const mockLogEvent = jest.fn();
            adminLogger.getLogEvent.mockReturnValue(mockLogEvent);

            const ctx = {
                from: { id: 123, first_name: 'Spammer' },
                chat: { id: -100123 }
            };

            await handleCasBan(ctx);

            expect(mockLogEvent).toHaveBeenCalledWith({
                guildId: -100123,
                eventType: 'ban',
                targetUser: ctx.from,
                executorAdmin: null,
                reason: 'CAS Ban (Combot Anti-Spam)',
                isGlobal: false
            });
        });
    });

    describe('processNewCasBans()', () => {
        it('should skip if no bot instance', async () => {
            jest.resetModules();
            const freshActions = require('../../../src/features/cas-ban/actions');
            freshActions.init(mockDb, null);

            await freshActions.processNewCasBans([{ user_id: 123 }]);

            // Should not throw
        });

        it('should ban new users across all guilds', async () => {
            mockDb.queryAll.mockResolvedValue([{ guild_id: -100001 }, { guild_id: -100002 }]);
            mockDb.queryOne.mockResolvedValue(null); // No global config

            const newUsers = [{ user_id: 111 }, { user_id: 222 }];

            await processNewCasBans(newUsers);

            // Should attempt to ban each user in each guild
            expect(mockBot.api.banChatMember).toHaveBeenCalled();
        });

        it('should handle ban failures gracefully', async () => {
            mockDb.queryAll.mockResolvedValue([{ guild_id: -100001 }]);
            mockDb.queryOne.mockResolvedValue(null);
            mockBot.api.banChatMember.mockRejectedValue(new Error('No rights'));

            const newUsers = [{ user_id: 123 }];

            await expect(processNewCasBans(newUsers)).resolves.not.toThrow();
        });

        it('should notify parliament if configured', async () => {
            mockDb.queryAll.mockResolvedValue([{ guild_id: -100001 }]);
            mockDb.queryOne.mockResolvedValue({
                parliament_group_id: -100999,
                global_topics: JSON.stringify({ bans: 12345 })
            });

            const newUsers = [{ user_id: 123 }];

            await processNewCasBans(newUsers);

            expect(mockBot.api.sendMessage).toHaveBeenCalledWith(
                -100999,
                expect.stringContaining('CAS SYNC REPORT'),
                expect.objectContaining({ message_thread_id: 12345 })
            );
        });
    });
});
