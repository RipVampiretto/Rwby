/**
 * Tests for ai-moderation/context.js
 */

// Need to test internal functions without requiring the module registration
describe('AI Moderation Context', () => {
    let context;

    beforeEach(() => {
        jest.resetModules();
        context = require('../../../src/features/ai-moderation/context');
    });

    describe('getContext()', () => {
        it('should return empty array for unknown chatId', () => {
            const result = context.getContext(-999999, 5);
            expect(result).toEqual([]);
        });

        it('should return empty array when no messages in buffer', () => {
            const result = context.getContext(-100123, 10);
            expect(result).toEqual([]);
        });
    });
});
