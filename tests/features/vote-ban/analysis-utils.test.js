/**
 * Tests for vote-ban/analysis-utils.js
 * Smart Report unified analysis engine
 */

// Mock dependencies
jest.mock('../../../src/features/nsfw-monitor/logic', () => ({
    analyzeMediaOnly: jest.fn()
}));

jest.mock('../../../src/features/ai-moderation/api', () => ({
    processWithAI: jest.fn()
}));

jest.mock('../../../src/features/ai-moderation/context', () => ({
    getContext: jest.fn().mockReturnValue([])
}));

const {
    hasMedia,
    getTextContent,
    getActionForCategory,
    analyzeTarget,
    analyzeContextMessages
} = require('../../../src/features/vote-ban/analysis-utils');

const nsfwLogic = require('../../../src/features/nsfw-monitor/logic');
const aiApi = require('../../../src/features/ai-moderation/api');
const { getContext } = require('../../../src/features/ai-moderation/context');

describe('Vote Ban Analysis Utils', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('hasMedia()', () => {
        it('should return true for photos', () => {
            expect(hasMedia({ photo: [{}] })).toBe(true);
        });

        it('should return true for videos', () => {
            expect(hasMedia({ video: {} })).toBe(true);
        });

        it('should return true for animations', () => {
            expect(hasMedia({ animation: {} })).toBe(true);
        });

        it('should return true for stickers', () => {
            expect(hasMedia({ sticker: {} })).toBe(true);
        });

        it('should return true for documents', () => {
            expect(hasMedia({ document: {} })).toBe(true);
        });

        it('should return false for text only', () => {
            expect(hasMedia({ text: 'Hello' })).toBe(false);
        });

        it('should return false for empty message', () => {
            expect(hasMedia({})).toBe(false);
        });
    });

    describe('getTextContent()', () => {
        it('should return text', () => {
            expect(getTextContent({ text: 'Hello world' })).toBe('Hello world');
        });

        it('should return caption', () => {
            expect(getTextContent({ caption: 'Photo caption' })).toBe('Photo caption');
        });

        it('should prefer text over caption', () => {
            expect(getTextContent({ text: 'Text', caption: 'Caption' })).toBe('Text');
        });

        it('should return empty string for no text', () => {
            expect(getTextContent({})).toBe('');
        });
    });

    describe('getActionForCategory()', () => {
        const config = {
            nsfw_action: 'ban',
            ai_action_scam: 'delete',
            ai_action_spam: 'report_only'
        };

        it('should return nsfw_action for NSFW', () => {
            expect(getActionForCategory(config, 'nsfw', true)).toBe('ban');
        });

        it('should return action for scam category', () => {
            expect(getActionForCategory(config, 'scam', false)).toBe('delete');
        });

        it('should return action for spam category', () => {
            expect(getActionForCategory(config, 'spam', false)).toBe('report_only');
        });

        it('should default to report_only for unknown category', () => {
            expect(getActionForCategory(config, 'unknown', false)).toBe('report_only');
        });

        it('should default nsfw_action to delete', () => {
            expect(getActionForCategory({}, 'nsfw', true)).toBe('delete');
        });
    });

    describe('analyzeTarget()', () => {
        const mockConfig = {
            ai_context_aware: false,
            ai_confidence_threshold: 0.75
        };

        it('should return no violation if no reply_to_message', async () => {
            const ctx = {
                message: {}
            };

            const result = await analyzeTarget(ctx, mockConfig);

            expect(result.isViolation).toBe(false);
        });

        it('should analyze media if present', async () => {
            nsfwLogic.analyzeMediaOnly.mockResolvedValue({ isNsfw: true, category: 'nudity' });

            const ctx = {
                message: {
                    reply_to_message: {
                        message_id: 123,
                        from: { id: 456 },
                        photo: [{}]
                    }
                },
                chat: { id: -100 },
                api: {}
            };

            const result = await analyzeTarget(ctx, mockConfig);

            expect(result.isViolation).toBe(true);
            expect(result.category).toBe('nudity');
        });

        it('should analyze text if no media', async () => {
            aiApi.processWithAI.mockResolvedValue({
                category: 'scam',
                confidence: 0.9,
                reason: 'Scam detected'
            });

            const ctx = {
                message: {
                    reply_to_message: {
                        message_id: 123,
                        from: { id: 456 },
                        text: 'This is a scam message with enough text'
                    }
                },
                chat: { id: -100 }
            };

            const result = await analyzeTarget(ctx, { ...mockConfig, report_action_scam: 'ban' });

            expect(result.isViolation).toBe(true);
            expect(result.category).toBe('scam');
        });

        it('should return safe if no violations', async () => {
            aiApi.processWithAI.mockResolvedValue({ category: 'safe', confidence: 0.95 });

            const ctx = {
                message: {
                    reply_to_message: {
                        message_id: 123,
                        from: { id: 456 },
                        text: 'Hello, this is a normal message text'
                    }
                },
                chat: { id: -100 }
            };

            const result = await analyzeTarget(ctx, mockConfig);

            expect(result.isViolation).toBe(false);
            expect(result.category).toBe('safe');
        });

        it('should skip short text', async () => {
            const ctx = {
                message: {
                    reply_to_message: {
                        message_id: 123,
                        from: { id: 456 },
                        text: 'Hi'
                    }
                },
                chat: { id: -100 }
            };

            const result = await analyzeTarget(ctx, mockConfig);

            expect(aiApi.processWithAI).not.toHaveBeenCalled();
        });
    });

    describe('analyzeContextMessages()', () => {
        it('should return empty array if no context', async () => {
            getContext.mockReturnValue([]);

            const ctx = { chat: { id: -100 } };
            const result = await analyzeContextMessages(ctx, {});

            expect(result).toEqual([]);
        });

        it('should analyze text messages in context', async () => {
            getContext.mockReturnValue([
                { messageId: 1, text: 'Normal text message here' },
                { messageId: 2, text: 'Another normal message' }
            ]);

            aiApi.processWithAI.mockResolvedValue({ category: 'safe', confidence: 0.9 });

            const ctx = { chat: { id: -100 } };
            const result = await analyzeContextMessages(ctx, {}, 10);

            expect(result).toHaveLength(2);
            expect(result[0].messageId).toBe(1);
        });

        it('should detect violations in context', async () => {
            getContext.mockReturnValue([
                { messageId: 1, text: 'This is scam content detected' }
            ]);

            aiApi.processWithAI.mockResolvedValue({
                category: 'scam',
                confidence: 0.95,
                reason: 'Scam'
            });

            const ctx = { chat: { id: -100 } };
            const result = await analyzeContextMessages(ctx, { ai_confidence_threshold: 0.75, report_action_scam: 'delete' }, 10);

            expect(result[0].isViolation).toBe(true);
            expect(result[0].category).toBe('scam');
        });

        it('should skip short messages', async () => {
            getContext.mockReturnValue([
                { messageId: 1, text: 'Hi' }
            ]);

            const ctx = { chat: { id: -100 } };
            const result = await analyzeContextMessages(ctx, {}, 10);

            expect(aiApi.processWithAI).not.toHaveBeenCalled();
        });
    });
});
