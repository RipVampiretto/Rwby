/**
 * Tests for nsfw-monitor/logic.js (unit tests, no actual LLM calls)
 */

const { NSFW_CATEGORIES, getDefaultBlockedCategories } = require('../../../src/features/nsfw-monitor/logic');

describe('NSFW Monitor Logic', () => {
    describe('NSFW_CATEGORIES', () => {
        it('should have all expected categories', () => {
            expect(NSFW_CATEGORIES.safe).toBeDefined();
            expect(NSFW_CATEGORIES.real_nudity).toBeDefined();
            expect(NSFW_CATEGORIES.real_sex).toBeDefined();
            expect(NSFW_CATEGORIES.hentai).toBeDefined();
            expect(NSFW_CATEGORIES.real_gore).toBeDefined();
            expect(NSFW_CATEGORIES.drawn_gore).toBeDefined();
            expect(NSFW_CATEGORIES.minors).toBeDefined();
        });

        it('should have name and description for each category', () => {
            Object.entries(NSFW_CATEGORIES).forEach(([key, category]) => {
                expect(category.name).toBeDefined();
                expect(category.description).toBeDefined();
            });
        });

        it('should mark safe as not blockable', () => {
            expect(NSFW_CATEGORIES.safe.blockable).toBe(false);
        });

        it('should mark minors as always blocked', () => {
            expect(NSFW_CATEGORIES.minors.alwaysBlocked).toBe(true);
        });

        it('should have blockable flag for NSFW categories', () => {
            const blockableCategories = ['real_nudity', 'real_sex', 'hentai', 'real_gore', 'drawn_gore'];
            blockableCategories.forEach(cat => {
                expect(NSFW_CATEGORIES[cat].blockable).not.toBe(false);
            });
        });
    });

    describe('getDefaultBlockedCategories()', () => {
        it('should return an array', () => {
            const defaults = getDefaultBlockedCategories();
            expect(Array.isArray(defaults)).toBe(true);
        });

        it('should include real_nudity by default', () => {
            const defaults = getDefaultBlockedCategories();
            expect(defaults).toContain('real_nudity');
        });

        it('should include real_sex by default', () => {
            const defaults = getDefaultBlockedCategories();
            expect(defaults).toContain('real_sex');
        });

        it('should include hentai by default', () => {
            const defaults = getDefaultBlockedCategories();
            expect(defaults).toContain('hentai');
        });

        it('should include gore categories by default', () => {
            const defaults = getDefaultBlockedCategories();
            expect(defaults).toContain('real_gore');
            expect(defaults).toContain('drawn_gore');
        });

        it('should include minors by default', () => {
            const defaults = getDefaultBlockedCategories();
            expect(defaults).toContain('minors');
        });

        it('should NOT include safe', () => {
            const defaults = getDefaultBlockedCategories();
            expect(defaults).not.toContain('safe');
        });
    });
});
