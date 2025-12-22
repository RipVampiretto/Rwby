/**
 * Tests for anti-edit-abuse/snapshots.js
 */

describe('Anti Edit Abuse Snapshots', () => {
    let snapshots;
    let mockDb;

    beforeEach(() => {
        jest.resetModules();
        jest.useFakeTimers();

        mockDb = {
            query: jest.fn().mockResolvedValue({ rowCount: 1 }),
            queryOne: jest.fn()
        };

        snapshots = require('../../../src/features/anti-edit-abuse/snapshots');
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('init()', () => {
        it('should store database reference', () => {
            snapshots.init(mockDb);
            // Verify by calling other functions
            expect(() =>
                snapshots.saveSnapshot({
                    message_id: 1,
                    chat: { id: -100 },
                    from: { id: 123 },
                    text: 'test'
                })
            ).not.toThrow();
        });
    });

    describe('saveSnapshot()', () => {
        beforeEach(() => {
            snapshots.init(mockDb);
        });

        it('should insert message snapshot', async () => {
            const message = {
                message_id: 123,
                chat: { id: -100123 },
                from: { id: 456 },
                text: 'Hello world'
            };

            await snapshots.saveSnapshot(message);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO message_snapshots'),
                expect.arrayContaining([123, -100123, 456])
            );
        });

        it('should detect links in message', async () => {
            const message = {
                message_id: 123,
                chat: { id: -100 },
                from: { id: 456 },
                text: 'Check https://example.com'
            };

            await snapshots.saveSnapshot(message);

            // 5th param is hasLink (true)
            expect(mockDb.query).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([true]));
        });

        it('should handle no text', async () => {
            const message = {
                message_id: 123,
                chat: { id: -100 },
                from: { id: 456 }
            };

            await snapshots.saveSnapshot(message);

            // hasLink should be false
            expect(mockDb.query).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([false]));
        });

        it('should not throw without db', async () => {
            jest.resetModules();
            const freshSnapshots = require('../../../src/features/anti-edit-abuse/snapshots');

            await expect(
                freshSnapshots.saveSnapshot({
                    message_id: 1,
                    chat: { id: -100 },
                    from: { id: 1 },
                    text: 'test'
                })
            ).resolves.not.toThrow();
        });
    });

    describe('getSnapshot()', () => {
        beforeEach(() => {
            snapshots.init(mockDb);
        });

        it('should query for snapshot by messageId and chatId', async () => {
            mockDb.queryOne.mockResolvedValue({
                message_id: 123,
                original_text: 'Hello'
            });

            const result = await snapshots.getSnapshot(123, -100123);

            expect(mockDb.queryOne).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM message_snapshots'),
                [123, -100123]
            );
            expect(result.original_text).toBe('Hello');
        });

        it('should return null when not found', async () => {
            mockDb.queryOne.mockResolvedValue(null);

            const result = await snapshots.getSnapshot(999, -100);

            expect(result).toBeNull();
        });

        it('should return null without db', async () => {
            jest.resetModules();
            const freshSnapshots = require('../../../src/features/anti-edit-abuse/snapshots');

            const result = await freshSnapshots.getSnapshot(123, -100);
            expect(result).toBeNull();
        });
    });

    describe('cleanupSnapshots()', () => {
        beforeEach(() => {
            snapshots.init(mockDb);
        });

        it('should delete old snapshots', async () => {
            await snapshots.cleanupSnapshots();

            expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM message_snapshots'));
        });

        it('should not throw without db', async () => {
            jest.resetModules();
            const freshSnapshots = require('../../../src/features/anti-edit-abuse/snapshots');

            await expect(freshSnapshots.cleanupSnapshots()).resolves.not.toThrow();
        });
    });
});
