/**
 * Tests for staff-coordination/logic.js
 */

// Mock dependent modules
jest.mock('../../../src/features/admin-logger', () => ({
    getLogEvent: jest.fn().mockReturnValue(null)
}));

describe('Staff Coordination Logic', () => {
    let logic;
    let mockDb;
    let mockBot;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();

        mockDb = {
            getGuildConfig: jest.fn(),
            query: jest.fn().mockResolvedValue({ rowCount: 1 }),
            queryAll: jest.fn().mockResolvedValue([])
        };

        mockBot = {
            api: {
                sendMessage: jest.fn().mockResolvedValue({ message_id: 123 }),
                banChatMember: jest.fn().mockResolvedValue(true),
                deleteMessage: jest.fn().mockResolvedValue(true)
            }
        };

        logic = require('../../../src/features/staff-coordination/logic');
    });

    describe('reviewQueue()', () => {
        it('should return false if no staff group configured', async () => {
            mockDb.getGuildConfig.mockResolvedValue({ staff_group_id: null });

            const result = await logic.reviewQueue(mockBot, mockDb, {
                guildId: -100123,
                source: 'test',
                user: { id: 456, first_name: 'Test' },
                reason: 'Test reason',
                messageId: 789,
                content: 'Test content'
            });

            expect(result).toBe(false);
        });

        it('should send review message to staff group', async () => {
            mockDb.getGuildConfig.mockResolvedValue({
                staff_group_id: -100999,
                staff_topics: null
            });

            const result = await logic.reviewQueue(mockBot, mockDb, {
                guildId: -100123,
                source: 'AI Moderation',
                user: { id: 456, first_name: 'TestUser' },
                reason: 'Scam detected',
                messageId: 789,
                content: 'Buy crypto now!'
            });

            expect(result).toBe(true);
            expect(mockBot.api.sendMessage).toHaveBeenCalledWith(
                -100999,
                expect.stringContaining('REVIEW REQUEST'),
                expect.any(Object)
            );
        });

        it('should include thread ID if staff_topics configured', async () => {
            mockDb.getGuildConfig.mockResolvedValue({
                staff_group_id: -100999,
                staff_topics: JSON.stringify({ reports: 12345 })
            });

            await logic.reviewQueue(mockBot, mockDb, {
                guildId: -100123,
                source: 'test',
                user: { id: 456, first_name: 'Test' },
                reason: 'reason',
                messageId: 789,
                content: 'content'
            });

            expect(mockBot.api.sendMessage).toHaveBeenCalledWith(
                expect.any(Number),
                expect.any(String),
                expect.objectContaining({ message_thread_id: 12345 })
            );
        });

        it('should return false if bot not provided', async () => {
            mockDb.getGuildConfig.mockResolvedValue({ staff_group_id: -100999 });

            const result = await logic.reviewQueue(null, mockDb, {
                guildId: -100123,
                source: 'test',
                user: { id: 456, first_name: 'Test' },
                reason: 'reason',
                messageId: 789,
                content: 'content'
            });

            expect(result).toBe(false);
        });

        it('should return false if db not provided', async () => {
            const result = await logic.reviewQueue(mockBot, null, {
                guildId: -100123
            });

            expect(result).toBe(false);
        });
    });

    describe('addNote()', () => {
        it('should insert staff note', async () => {
            const ctx = { from: { id: 111 } };

            await logic.addNote(mockDb, ctx, 456, 'This user is suspicious', -100999);

            expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO staff_notes'), [
                456,
                -100999,
                'This user is suspicious',
                111
            ]);
        });
    });

    describe('getNotes()', () => {
        it('should retrieve staff notes for user', async () => {
            const notes = [
                { id: 1, note_text: 'Note 1' },
                { id: 2, note_text: 'Note 2' }
            ];
            mockDb.queryAll.mockResolvedValue(notes);

            const result = await logic.getNotes(mockDb, 456, -100999);

            expect(result).toEqual(notes);
            expect(mockDb.queryAll).toHaveBeenCalledWith(expect.stringContaining('staff_notes'), [456, -100999]);
        });
    });
});
