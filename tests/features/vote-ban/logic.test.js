/**
 * Tests for vote-ban/logic.js
 */

const logic = require('../../../src/features/vote-ban/logic');

describe('Vote Ban Logic', () => {
    let mockDb;

    beforeEach(() => {
        mockDb = {
            query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [{ vote_id: 1 }] }),
            queryOne: jest.fn(),
            queryAll: jest.fn().mockResolvedValue([])
        };
    });

    describe('createVote()', () => {
        it('should insert vote into database and return vote_id', async () => {
            const params = {
                target: { id: 456, username: 'baduser' },
                chat: { id: -100123 },
                initiator: { id: 789 },
                reason: 'Spam',
                required: 5,
                expires: new Date(),
                voters: [789]
            };

            const voteId = await logic.createVote(mockDb, params);

            expect(voteId).toBe(1);
            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO active_votes'),
                expect.arrayContaining([456, 'baduser', -100123, 789, 'Spam', 5])
            );
        });
    });

    describe('getVote()', () => {
        it('should return vote by ID', async () => {
            const vote = { vote_id: 1, target_user_id: 456 };
            mockDb.queryOne.mockResolvedValue(vote);

            const result = await logic.getVote(mockDb, 1);

            expect(result).toEqual(vote);
            expect(mockDb.queryOne).toHaveBeenCalledWith(
                expect.stringContaining('active_votes'),
                [1]
            );
        });
    });

    describe('getActiveVoteForUser()', () => {
        it('should return active vote for target user', async () => {
            const vote = { vote_id: 1, target_user_id: 456, status: 'active' };
            mockDb.queryOne.mockResolvedValue(vote);

            const result = await logic.getActiveVoteForUser(mockDb, -100123, 456);

            expect(result).toEqual(vote);
            expect(mockDb.queryOne).toHaveBeenCalledWith(
                expect.stringContaining("status = 'active'"),
                [-100123, 456]
            );
        });

        it('should return null if no active vote', async () => {
            mockDb.queryOne.mockResolvedValue(null);

            const result = await logic.getActiveVoteForUser(mockDb, -100123, 999);

            expect(result).toBeNull();
        });
    });

    describe('getExpiredVotes()', () => {
        it('should return votes past expiration', async () => {
            const pastDate = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
            const futureDate = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now

            mockDb.queryAll.mockResolvedValue([
                { vote_id: 1, expires_at: pastDate },
                { vote_id: 2, expires_at: futureDate }
            ]);

            const result = await logic.getExpiredVotes(mockDb);

            expect(result).toHaveLength(1);
            expect(result[0].vote_id).toBe(1);
        });

        it('should return empty array if no votes expired', async () => {
            const futureDate = new Date(Date.now() + 3600000).toISOString();
            mockDb.queryAll.mockResolvedValue([
                { vote_id: 1, expires_at: futureDate }
            ]);

            const result = await logic.getExpiredVotes(mockDb);

            expect(result).toHaveLength(0);
        });
    });

    describe('getAllActiveVotes()', () => {
        it('should return all active votes', async () => {
            const votes = [{ vote_id: 1 }, { vote_id: 2 }];
            mockDb.queryAll.mockResolvedValue(votes);

            const result = await logic.getAllActiveVotes(mockDb);

            expect(result).toEqual(votes);
        });
    });

    describe('updateVote()', () => {
        it('should update vote counts and voters', async () => {
            await logic.updateVote(mockDb, 1, 5, 2, [1, 2, 3, 4, 5, 6, 7]);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE active_votes'),
                [5, 2, JSON.stringify([1, 2, 3, 4, 5, 6, 7]), 1]
            );
        });
    });

    describe('setPollMessageId()', () => {
        it('should update poll message ID', async () => {
            await logic.setPollMessageId(mockDb, 1, 12345);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('poll_message_id'),
                [12345, 1]
            );
        });
    });

    describe('closeVote()', () => {
        it('should update vote status', async () => {
            await logic.closeVote(mockDb, 1, 'banned');

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('status'),
                ['banned', 1]
            );
        });
    });
});
