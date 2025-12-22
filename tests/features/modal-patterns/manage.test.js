/**
 * Tests for modal-patterns/manage.js
 */

// Mock logic module to avoid dependencies
jest.mock('../../../src/features/modal-patterns/logic', () => ({
    isModalEnabledForGuild: jest.fn().mockResolvedValue(true),
    refreshCache: jest.fn().mockResolvedValue(undefined),
    safeJsonParse: jest.fn().mockImplementation((str, fallback) => {
        try { return JSON.parse(str); } catch { return fallback; }
    })
}));

describe('Modal Patterns Manage', () => {
    let manage;
    let mockDb;
    let logic;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();

        mockDb = {
            query: jest.fn().mockResolvedValue({ rowCount: 1 }),
            queryOne: jest.fn(),
            queryAll: jest.fn().mockResolvedValue([])
        };

        logic = require('../../../src/features/modal-patterns/logic');
        manage = require('../../../src/features/modal-patterns/manage');
        manage.init(mockDb);
    });

    describe('toggleGuildModal()', () => {
        it('should toggle modal state for guild', async () => {
            logic.isModalEnabledForGuild.mockResolvedValue(true);

            const result = await manage.toggleGuildModal(-100123, 1);

            expect(result).toBe(false); // Toggled from true to false
            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('guild_modal_overrides'),
                expect.arrayContaining([-100123, 1, false])
            );
        });

        it('should return null without db', async () => {
            jest.resetModules();
            const freshManage = require('../../../src/features/modal-patterns/manage');
            // Don't call init

            const result = await freshManage.toggleGuildModal(-100123, 1);
            expect(result).toBeNull();
        });
    });

    describe('listModals()', () => {
        it('should return all modals when no language specified', async () => {
            const modals = [{ id: 1 }, { id: 2 }];
            mockDb.queryAll.mockResolvedValue(modals);

            const result = await manage.listModals();

            expect(result).toEqual(modals);
            expect(mockDb.queryAll).toHaveBeenCalledWith(
                expect.stringContaining('ORDER BY language')
            );
        });

        it('should filter by language when specified', async () => {
            const modals = [{ id: 1, language: 'it' }];
            mockDb.queryAll.mockResolvedValue(modals);

            const result = await manage.listModals('it');

            expect(result).toEqual(modals);
            expect(mockDb.queryAll).toHaveBeenCalledWith(
                expect.stringContaining('language = $1'),
                ['it']
            );
        });
    });

    describe('getModal()', () => {
        it('should return modal by language and category', async () => {
            const modal = { id: 1, language: 'it', category: 'scam', patterns: '[]' };
            mockDb.queryOne.mockResolvedValue(modal);

            const result = await manage.getModal('it', 'scam');

            expect(result).toEqual(modal);
            expect(mockDb.queryOne).toHaveBeenCalledWith(
                expect.stringContaining('spam_modals'),
                ['it', 'scam']
            );
        });

        it('should return null if not found', async () => {
            mockDb.queryOne.mockResolvedValue(null);

            const result = await manage.getModal('en', 'unknown');
            expect(result).toBeNull();
        });
    });

    describe('upsertModal()', () => {
        it('should upsert modal with patterns', async () => {
            await manage.upsertModal('it', 'scam', ['pattern1', 'pattern2']);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO spam_modals'),
                expect.arrayContaining(['it', 'scam'])
            );
            expect(logic.refreshCache).toHaveBeenCalled();
        });
    });

    describe('deleteModal()', () => {
        it('should delete modal and return true', async () => {
            mockDb.query.mockResolvedValue({ rowCount: 1 });

            const result = await manage.deleteModal('it', 'scam');

            expect(result).toBe(true);
            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM spam_modals'),
                ['it', 'scam']
            );
        });

        it('should return false if nothing deleted', async () => {
            mockDb.query.mockResolvedValue({ rowCount: 0 });

            const result = await manage.deleteModal('en', 'unknown');
            expect(result).toBe(false);
        });
    });

    describe('toggleModal()', () => {
        it('should toggle modal enabled state', async () => {
            mockDb.queryOne.mockResolvedValue({ enabled: true });

            const result = await manage.toggleModal('it', 'scam');

            expect(result).toBe(false);
            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('enabled = $1'),
                [false, 'it', 'scam']
            );
        });

        it('should return null if modal not found', async () => {
            mockDb.queryOne.mockResolvedValue(null);

            const result = await manage.toggleModal('en', 'unknown');
            expect(result).toBeNull();
        });
    });

    describe('updateModalAction()', () => {
        it('should update action', async () => {
            await manage.updateModalAction('it', 'scam', 'delete');

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('action = $1'),
                ['delete', 'it', 'scam']
            );
        });
    });

    describe('addPatternsToModal()', () => {
        it('should add new patterns to existing', async () => {
            mockDb.queryOne.mockResolvedValue({
                patterns: '["existing"]'
            });

            const result = await manage.addPatternsToModal('it', 'scam', ['new1', 'new2']);

            expect(result).toBe(true);
            expect(mockDb.query).toHaveBeenCalled();
        });

        it('should return false if modal not found', async () => {
            mockDb.queryOne.mockResolvedValue(null);

            const result = await manage.addPatternsToModal('en', 'missing', ['pattern']);
            expect(result).toBe(false);
        });
    });

    describe('removePatternsFromModal()', () => {
        it('should remove patterns', async () => {
            mockDb.queryOne.mockResolvedValue({
                patterns: '["keep", "remove1", "remove2"]'
            });

            const result = await manage.removePatternsFromModal('it', 'scam', ['remove1', 'remove2']);

            expect(result).toBe(true);
        });

        it('should return false if modal not found', async () => {
            mockDb.queryOne.mockResolvedValue(null);

            const result = await manage.removePatternsFromModal('en', 'missing', ['pattern']);
            expect(result).toBe(false);
        });
    });
});
