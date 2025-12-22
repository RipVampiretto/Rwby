/**
 * Tests for anti-edit-abuse/detection.js
 */

const { similarity, editDistance } = require('../../../src/features/anti-edit-abuse/detection');

describe('Anti Edit Abuse Detection', () => {
    describe('similarity()', () => {
        it('should return 1 for identical strings', () => {
            const result = similarity('hello world', 'hello world');
            expect(result).toBe(1);
        });

        it('should return 0 for completely different strings of same length', () => {
            const result = similarity('abcd', 'wxyz');
            expect(result).toBe(0);
        });

        it('should return value between 0 and 1 for partial matches', () => {
            const result = similarity('hello world', 'hello there');
            expect(result).toBeGreaterThan(0);
            expect(result).toBeLessThan(1);
        });

        it('should return 1 for both empty strings', () => {
            expect(similarity('', '')).toBe(1);
        });

        it('should return 0 when one string is empty', () => {
            expect(similarity('hello', '')).toBe(0);
            expect(similarity('', 'world')).toBe(0);
        });

        it('should be case insensitive (via editDistance)', () => {
            const result = similarity('HELLO', 'hello');
            expect(result).toBe(1);
        });

        it('should handle strings with different lengths', () => {
            const result = similarity('hello', 'hello world');
            expect(result).toBeGreaterThan(0);
            expect(result).toBeLessThan(1);
        });
    });

    describe('editDistance()', () => {
        it('should return 0 for identical strings', () => {
            expect(editDistance('hello', 'hello')).toBe(0);
        });

        it('should return length for completely different string', () => {
            // abc -> xyz requires 3 substitutions
            expect(editDistance('abc', 'xyz')).toBe(3);
        });

        it('should count insertions', () => {
            // hello -> helloo requires 1 insertion
            expect(editDistance('hello', 'helloo')).toBe(1);
        });

        it('should count deletions', () => {
            // hello -> hell requires 1 deletion
            expect(editDistance('hello', 'hell')).toBe(1);
        });

        it('should count substitutions', () => {
            // hello -> hallo requires 1 substitution
            expect(editDistance('hello', 'hallo')).toBe(1);
        });

        it('should be case insensitive', () => {
            expect(editDistance('HELLO', 'hello')).toBe(0);
        });

        it('should handle empty strings', () => {
            expect(editDistance('', '')).toBe(0);
            expect(editDistance('abc', '')).toBe(3);
            expect(editDistance('', 'xyz')).toBe(3);
        });
    });
});
