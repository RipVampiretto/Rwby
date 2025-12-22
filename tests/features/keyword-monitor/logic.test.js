/**
 * Tests for keyword-monitor/logic.js
 */

const { escapeRegExp, scanMessage } = require('../../../src/features/keyword-monitor/logic');

describe('Keyword Monitor Logic', () => {
    describe('escapeRegExp()', () => {
        it('should escape special regex characters', () => {
            expect(escapeRegExp('hello.world')).toBe('hello\\.world');
            expect(escapeRegExp('a*b+c?')).toBe('a\\*b\\+c\\?');
            expect(escapeRegExp('[test]')).toBe('\\[test\\]');
            expect(escapeRegExp('(group)')).toBe('\\(group\\)');
            expect(escapeRegExp('a|b')).toBe('a\\|b');
            expect(escapeRegExp('^start$end')).toBe('\\^start\\$end');
            expect(escapeRegExp('path\\to\\file')).toBe('path\\\\to\\\\file');
        });

        it('should handle normal text without changes', () => {
            expect(escapeRegExp('hello world')).toBe('hello world');
            expect(escapeRegExp('test123')).toBe('test123');
            expect(escapeRegExp('')).toBe('');
        });

        it('should handle multiple special characters', () => {
            expect(escapeRegExp('(a+b)*c?')).toBe('\\(a\\+b\\)\\*c\\?');
        });
    });

    describe('scanMessage()', () => {
        // Mock database with word_filters
        let mockDb;
        let mockCtx;

        beforeEach(() => {
            mockDb = {
                queryAll: jest.fn()
            };
            mockCtx = {
                message: { text: '' },
                chat: { id: -1001234567890 },
                userTier: 0
            };
        });

        it('should return null when no filters match', async () => {
            mockDb.queryAll.mockResolvedValue([
                { word: 'badword', is_regex: false, action: 'delete', match_whole_word: false }
            ]);
            mockCtx.message.text = 'Hello world';

            // Need to initialize the module first
            const logic = require('../../../src/features/keyword-monitor/logic');
            logic.init(mockDb);

            const result = await logic.scanMessage(mockCtx);
            expect(result).toBeNull();
        });

        it('should match partial word (default)', async () => {
            mockDb.queryAll.mockResolvedValue([
                { word: 'bad', is_regex: false, action: 'delete', match_whole_word: false }
            ]);
            mockCtx.message.text = 'This is badword here';

            const logic = require('../../../src/features/keyword-monitor/logic');
            logic.init(mockDb);

            const result = await logic.scanMessage(mockCtx);
            expect(result).not.toBeNull();
            expect(result.word).toBe('bad');
            expect(result.action).toBe('delete');
        });

        it('should be case insensitive', async () => {
            mockDb.queryAll.mockResolvedValue([
                { word: 'badword', is_regex: false, action: 'delete', match_whole_word: false }
            ]);
            mockCtx.message.text = 'This has BADWORD in it';

            const logic = require('../../../src/features/keyword-monitor/logic');
            logic.init(mockDb);

            const result = await logic.scanMessage(mockCtx);
            expect(result).not.toBeNull();
        });

        it('should match whole word only when configured', async () => {
            mockDb.queryAll.mockResolvedValue([
                { word: 'bad', is_regex: false, action: 'delete', match_whole_word: true }
            ]);

            const logic = require('../../../src/features/keyword-monitor/logic');
            logic.init(mockDb);

            // Should not match - 'bad' is part of 'badword'
            mockCtx.message.text = 'This is badword';
            let result = await logic.scanMessage(mockCtx);
            expect(result).toBeNull();

            // Should match - 'bad' is a whole word
            mockCtx.message.text = 'This is bad word';
            result = await logic.scanMessage(mockCtx);
            expect(result).not.toBeNull();
        });

        it('should support regex patterns', async () => {
            mockDb.queryAll.mockResolvedValue([
                { word: 'scam\\d+', is_regex: true, action: 'ban', match_whole_word: false }
            ]);
            mockCtx.message.text = 'Check out scam123 here';

            const logic = require('../../../src/features/keyword-monitor/logic');
            logic.init(mockDb);

            const result = await logic.scanMessage(mockCtx);
            expect(result).not.toBeNull();
            expect(result.action).toBe('ban');
        });

        it('should handle invalid regex gracefully', async () => {
            mockDb.queryAll.mockResolvedValue([
                { word: '[invalid(regex', is_regex: true, action: 'delete', match_whole_word: false }
            ]);
            mockCtx.message.text = 'Normal text';

            const logic = require('../../../src/features/keyword-monitor/logic');
            logic.init(mockDb);

            // Should not crash, just return null
            const result = await logic.scanMessage(mockCtx);
            expect(result).toBeNull();
        });

        it('should skip filter if user tier >= bypass_tier', async () => {
            mockDb.queryAll.mockResolvedValue([
                { word: 'badword', is_regex: false, action: 'delete', match_whole_word: false, bypass_tier: 2 }
            ]);
            mockCtx.message.text = 'This has badword';
            mockCtx.userTier = 2; // Tier matches bypass

            const logic = require('../../../src/features/keyword-monitor/logic');
            logic.init(mockDb);

            const result = await logic.scanMessage(mockCtx);
            expect(result).toBeNull();
        });

        it('should match filter if user tier < bypass_tier', async () => {
            mockDb.queryAll.mockResolvedValue([
                { word: 'badword', is_regex: false, action: 'delete', match_whole_word: false, bypass_tier: 2 }
            ]);
            mockCtx.message.text = 'This has badword';
            mockCtx.userTier = 1; // Tier below bypass

            const logic = require('../../../src/features/keyword-monitor/logic');
            logic.init(mockDb);

            const result = await logic.scanMessage(mockCtx);
            expect(result).not.toBeNull();
        });

        it('should return fullText in result', async () => {
            mockDb.queryAll.mockResolvedValue([
                { word: 'spam', is_regex: false, action: 'delete', match_whole_word: false }
            ]);
            mockCtx.message.text = 'This is spam message';

            const logic = require('../../../src/features/keyword-monitor/logic');
            logic.init(mockDb);

            const result = await logic.scanMessage(mockCtx);
            expect(result.fullText).toBe('This is spam message');
        });
    });
});
