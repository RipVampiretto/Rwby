/**
 * Tests for modal-patterns/logic.js
 */

const { jaccardSimilarity, safeJsonParse, init } = require('../../../src/features/modal-patterns/logic');

describe('Modal Patterns Logic', () => {
    describe('jaccardSimilarity()', () => {
        it('should return 1 for identical strings', () => {
            const similarity = jaccardSimilarity('hello world test', 'hello world test');
            expect(similarity).toBe(1);
        });

        it('should return 0 for completely different strings', () => {
            const similarity = jaccardSimilarity('hello world', 'foo bar baz');
            expect(similarity).toBe(0);
        });

        it('should return value between 0 and 1 for partial matches', () => {
            const similarity = jaccardSimilarity('hello world test', 'hello world different');
            expect(similarity).toBeGreaterThan(0);
            expect(similarity).toBeLessThan(1);
        });

        it('should ignore short tokens (<=2 chars)', () => {
            // "a b c" has only short tokens, should effectively be empty
            const similarity = jaccardSimilarity('a b c', 'x y z');
            expect(similarity).toBe(0);
        });

        it('should return 0 for empty strings', () => {
            expect(jaccardSimilarity('', '')).toBe(0);
            expect(jaccardSimilarity('hello', '')).toBe(0);
            expect(jaccardSimilarity('', 'world')).toBe(0);
        });

        it('should calculate correct Jaccard index', () => {
            // "apple banana" and "banana cherry"
            // Tokens: {apple, banana} and {banana, cherry}
            // Intersection: {banana} = 1
            // Union: {apple, banana, cherry} = 3
            // Jaccard = 1/3 ≈ 0.333
            const similarity = jaccardSimilarity('apple banana', 'banana cherry');
            expect(similarity).toBeCloseTo(0.333, 2);
        });

        it('should handle duplicate tokens in one string', () => {
            // Sets ignore duplicates
            const similarity = jaccardSimilarity('hello hello world', 'hello world');
            expect(similarity).toBe(1);
        });
    });

    describe('safeJsonParse()', () => {
        it('should parse valid JSON string', () => {
            const result = safeJsonParse('{"key": "value"}', {});
            expect(result).toEqual({ key: 'value' });
        });

        it('should parse JSON array', () => {
            const result = safeJsonParse('["a", "b", "c"]', []);
            expect(result).toEqual(['a', 'b', 'c']);
        });

        it('should return default value for invalid JSON', () => {
            const result = safeJsonParse('not valid json', { default: true });
            expect(result).toEqual({ default: true });
        });

        it('should return default value for empty string', () => {
            const result = safeJsonParse('', []);
            expect(result).toEqual([]);
        });

        it('should return object directly if already parsed', () => {
            const input = { already: 'parsed' };
            const result = safeJsonParse(input, {});
            expect(result).toBe(input);
        });

        it('should return array directly if already parsed', () => {
            const input = ['already', 'parsed'];
            const result = safeJsonParse(input, []);
            expect(result).toBe(input);
        });

        it('should return default for null input', () => {
            // null is an object, so it will be returned as-is
            const result = safeJsonParse(null, { default: true });
            expect(result).toBeNull();
        });
    });

    describe('checkMessageAgainstModals()', () => {
        let mockDb;
        let mockCtx;
        let mockConfig;

        beforeEach(() => {
            mockDb = {
                queryAll: jest.fn().mockResolvedValue([]),
                queryOne: jest.fn().mockResolvedValue(null)
            };

            mockCtx = {
                message: { text: '' },
                chat: { id: -1001234567890 }
            };

            mockConfig = {
                allowed_languages: '["en"]',
                modal_action: 'report_only'
            };

            init(mockDb);

            // Clear the modal cache
            jest.resetModules();
        });

        it('should return null for short messages', async () => {
            mockCtx.message.text = 'Hi';

            const logic = require('../../../src/features/modal-patterns/logic');
            logic.init(mockDb);

            const result = await logic.checkMessageAgainstModals(mockCtx, mockConfig);
            expect(result).toBeNull();
        });

        it('should return null when no modals match', async () => {
            mockDb.queryAll.mockResolvedValue([
                {
                    id: 1,
                    language: 'en',
                    category: 'scam',
                    patterns: '["buy bitcoin now guaranteed profit"]',
                    similarity_threshold: 0.6,
                    action: 'delete'
                }
            ]);
            mockCtx.message.text = 'Hello everyone, how are you doing today?';

            const logic = require('../../../src/features/modal-patterns/logic');
            logic.init(mockDb);

            const result = await logic.checkMessageAgainstModals(mockCtx, mockConfig);
            expect(result).toBeNull();
        });

        it('should detect matching spam pattern', async () => {
            mockDb.queryAll.mockResolvedValue([
                {
                    id: 1,
                    language: 'en',
                    category: 'scam',
                    patterns: '["invest now guaranteed returns bitcoin profit"]',
                    similarity_threshold: 0.5,
                    action: 'ban'
                }
            ]);
            mockCtx.message.text = 'invest now get guaranteed returns with bitcoin profit opportunity';

            const logic = require('../../../src/features/modal-patterns/logic');
            logic.init(mockDb);

            const result = await logic.checkMessageAgainstModals(mockCtx, mockConfig);
            expect(result).not.toBeNull();
            expect(result.category).toBe('scam');
        });
    });
});
