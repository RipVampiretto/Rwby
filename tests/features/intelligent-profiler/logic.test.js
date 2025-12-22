/**
 * Tests for intelligent-profiler/logic.js
 */

describe('Intelligent Profiler Logic', () => {
    let logic;
    let mockDb;

    beforeEach(() => {
        jest.resetModules();
        mockDb = {
            queryAll: jest.fn().mockResolvedValue([])
        };
        logic = require('../../../src/features/intelligent-profiler/logic');
        logic.init(mockDb);
    });

    describe('escapeRegExp()', () => {
        it('should escape special regex characters', () => {
            expect(logic.escapeRegExp('hello.world')).toBe('hello\\.world');
            expect(logic.escapeRegExp('a*b+c?')).toBe('a\\*b\\+c\\?');
            expect(logic.escapeRegExp('[test]')).toBe('\\[test\\]');
        });
    });

    describe('extractLinks()', () => {
        it('should extract http links', () => {
            const links = logic.extractLinks('Check http://example.com');
            expect(links).toContain('http://example.com');
        });

        it('should extract https links', () => {
            const links = logic.extractLinks('Visit https://secure.com/path');
            expect(links).toContain('https://secure.com/path');
        });

        it('should return empty array for no links', () => {
            const links = logic.extractLinks('No links here');
            expect(links).toEqual([]);
        });

        it('should extract multiple links', () => {
            const links = logic.extractLinks('Site 1: http://a.com and https://b.com');
            expect(links).toHaveLength(2);
        });
    });

    describe('getScamPatterns()', () => {
        it('should return patterns from database', async () => {
            mockDb.queryAll.mockResolvedValue([
                { word: 'scam', is_regex: false },
                { word: 'crypto\\d+', is_regex: true }
            ]);

            const patterns = await logic.getScamPatterns();

            expect(patterns).toHaveLength(2);
            expect(patterns[0]).toBeInstanceOf(RegExp);
            expect(patterns[1]).toBeInstanceOf(RegExp);
        });

        it('should return empty array without db', async () => {
            jest.resetModules();
            const freshLogic = require('../../../src/features/intelligent-profiler/logic');

            const patterns = await freshLogic.getScamPatterns();
            expect(patterns).toEqual([]);
        });

        it('should escape non-regex patterns', async () => {
            mockDb.queryAll.mockResolvedValue([
                { word: 'test.pattern', is_regex: false }
            ]);

            const patterns = await logic.getScamPatterns();

            // Should not match 'testXpattern' (dot should be literal)
            expect(patterns[0].test('testXpattern')).toBe(false);
            expect(patterns[0].test('test.pattern')).toBe(true);
        });
    });

    describe('scanMessage()', () => {
        const mockConfig = {
            profiler_action_link: 'delete',
            profiler_action_forward: 'delete',
            profiler_action_pattern: 'report_only'
        };

        it('should return null for safe message', async () => {
            const ctx = {
                message: { text: 'Hello everyone!' }
            };

            const result = await logic.scanMessage(ctx, mockConfig);
            expect(result).toBeNull();
        });

        it('should detect links not in whitelist', async () => {
            mockDb.queryAll.mockResolvedValue([]); // No whitelist

            const ctx = {
                message: { text: 'Check https://suspicious.com' }
            };

            const result = await logic.scanMessage(ctx, mockConfig);

            expect(result).not.toBeNull();
            expect(result.reason).toBe('Tier 0 Link');
            expect(result.action).toBe('delete');
        });

        it('should allow whitelisted domains', async () => {
            // First call for whitelist
            mockDb.queryAll
                .mockResolvedValueOnce([{ value: 'trusted.com' }]) // whitelist
                .mockResolvedValueOnce([]); // scam patterns

            const ctx = {
                message: { text: 'Visit https://trusted.com/page' }
            };

            const result = await logic.scanMessage(ctx, mockConfig);
            expect(result).toBeNull();
        });

        it('should detect forwarded messages', async () => {
            const ctx = {
                message: {
                    text: 'Hello',
                    forward_from: { id: 999 }
                }
            };

            const result = await logic.scanMessage(ctx, mockConfig);

            expect(result).not.toBeNull();
            expect(result.reason).toBe('Tier 0 Forward');
        });

        it('should detect forwarded from channel', async () => {
            const ctx = {
                message: {
                    text: 'Hello',
                    forward_from_chat: { id: -100999 }
                }
            };

            const result = await logic.scanMessage(ctx, mockConfig);

            expect(result).not.toBeNull();
            expect(result.reason).toBe('Tier 0 Forward');
        });

        it('should detect scam patterns with score >= 2', async () => {
            // Mock: first call for whitelist (in scanMessage), second for patterns (in getScamPatterns)
            mockDb.queryAll.mockImplementation((sql) => {
                if (sql.includes('intel_data')) {
                    return Promise.resolve([]); // No whitelist
                }
                if (sql.includes('word_filters')) {
                    return Promise.resolve([
                        { word: 'crypto', is_regex: false },
                        { word: 'guaranteed', is_regex: false },
                        { word: 'profit', is_regex: false }
                    ]);
                }
                return Promise.resolve([]);
            });

            const ctx = {
                message: { text: 'Invest in crypto with guaranteed profit now!' }
            };

            const result = await logic.scanMessage(ctx, mockConfig);

            expect(result).not.toBeNull();
            expect(result.reason).toContain('Scam Pattern');
            expect(result.action).toBe('report_only');
        });

        it('should not trigger for single pattern match', async () => {
            mockDb.queryAll
                .mockResolvedValueOnce([]) // whitelist
                .mockResolvedValueOnce([
                    { word: 'hello', is_regex: false },
                    { word: 'world', is_regex: false }
                ]);

            const ctx = {
                message: { text: 'Hello everyone!' }
            };

            const result = await logic.scanMessage(ctx, mockConfig);
            expect(result).toBeNull();
        });

        it('should handle message caption', async () => {
            mockDb.queryAll.mockResolvedValue([]);

            const ctx = {
                message: { caption: 'Check https://evil.com' }
            };

            const result = await logic.scanMessage(ctx, mockConfig);

            expect(result).not.toBeNull();
            expect(result.reason).toBe('Tier 0 Link');
        });
    });
});
