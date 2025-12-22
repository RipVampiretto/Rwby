/**
 * Tests for ai-moderation/api.js
 */

// Mock fetch globally
global.fetch = jest.fn();

describe('AI Moderation API', () => {
    let api;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();

        // Set environment variables
        process.env.LM_STUDIO_URL = 'http://localhost:1234';
        process.env.LM_STUDIO_MODEL = 'test-model';

        api = require('../../../src/features/ai-moderation/api');
    });

    describe('djb2() hash function', () => {
        // We need to access the internal function
        // Since it's not exported, we test it indirectly through processWithAI caching

        it('should produce consistent hashes for same input', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({
                    choices: [{ message: { content: '{"category": "safe", "confidence": 0.9}' } }]
                })
            };
            global.fetch.mockResolvedValue(mockResponse);

            // First call
            await api.processWithAI('test message', [], {});
            const firstCallCount = global.fetch.mock.calls.length;

            // Second call with same input - should use cache
            await api.processWithAI('test message', [], {});
            const secondCallCount = global.fetch.mock.calls.length;

            // Should not have made additional fetch call due to caching
            expect(secondCallCount).toBe(firstCallCount);
        });
    });

    describe('processWithAI()', () => {
        it('should return cached result for repeated calls', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({
                    choices: [{ message: { content: '{"category": "safe", "confidence": 0.95}' } }]
                })
            };
            global.fetch.mockResolvedValue(mockResponse);

            const result1 = await api.processWithAI('hello world', [], {});
            const result2 = await api.processWithAI('hello world', [], {});

            expect(result1).toEqual(result2);
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        it('should make new call for different text', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({
                    choices: [{ message: { content: '{"category": "safe", "confidence": 0.9}' } }]
                })
            };
            global.fetch.mockResolvedValue(mockResponse);

            await api.processWithAI('message one', [], {});
            await api.processWithAI('message two', [], {});

            expect(global.fetch).toHaveBeenCalledTimes(2);
        });
    });

    describe('callLLM()', () => {
        it('should return parsed JSON response', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({
                    choices: [{
                        message: {
                            content: '{"category": "scam", "confidence": 0.85, "reason": "Crypto scheme detected"}'
                        }
                    }]
                })
            };
            global.fetch.mockResolvedValue(mockResponse);

            const result = await api.callLLM('Buy bitcoin now!', [], {});

            expect(result.category).toBe('scam');
            expect(result.confidence).toBe(0.85);
            expect(result.reason).toBe('Crypto scheme detected');
        });

        it('should extract JSON from markdown code blocks', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({
                    choices: [{
                        message: {
                            content: '```json\n{"category": "spam", "confidence": 0.9}\n```'
                        }
                    }]
                })
            };
            global.fetch.mockResolvedValue(mockResponse);

            const result = await api.callLLM('Spam message', [], {});

            expect(result.category).toBe('spam');
        });

        it('should return safe on API error', async () => {
            global.fetch.mockRejectedValue(new Error('Connection refused'));

            const result = await api.callLLM('Some text', [], {});

            expect(result.category).toBe('safe');
            expect(result.confidence).toBe(1);
        });

        it('should return safe on non-ok response', async () => {
            global.fetch.mockResolvedValue({ ok: false });

            const result = await api.callLLM('Some text', [], {});

            expect(result.category).toBe('safe');
        });

        it('should return safe on invalid JSON response', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({
                    choices: [{ message: { content: 'Not valid JSON at all' } }]
                })
            };
            global.fetch.mockResolvedValue(mockResponse);

            const result = await api.callLLM('Some text', [], {});

            expect(result.category).toBe('safe');
        });

        it('should include context messages in prompt', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({
                    choices: [{ message: { content: '{"category": "safe", "confidence": 0.9}' } }]
                })
            };
            global.fetch.mockResolvedValue(mockResponse);

            const contextMessages = [
                { username: 'user1', text: 'Previous message 1' },
                { username: 'user2', text: 'Previous message 2' }
            ];

            await api.callLLM('Current message', contextMessages, {});

            const fetchCall = global.fetch.mock.calls[0];
            const body = JSON.parse(fetchCall[1].body);
            const userContent = body.messages[1].content;

            expect(userContent).toContain('Previous message 1');
            expect(userContent).toContain('Previous message 2');
        });

        it('should use custom model when specified', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({
                    choices: [{ message: { content: '{"category": "safe", "confidence": 0.9}' } }]
                })
            };
            global.fetch.mockResolvedValue(mockResponse);

            await api.callLLM('message', [], {}, 'custom-model');

            const fetchCall = global.fetch.mock.calls[0];
            const body = JSON.parse(fetchCall[1].body);

            expect(body.model).toBe('custom-model');
        });

        it('should call correct endpoint', async () => {
            const mockResponse = {
                ok: true,
                json: () => Promise.resolve({
                    choices: [{ message: { content: '{"category": "safe", "confidence": 0.9}' } }]
                })
            };
            global.fetch.mockResolvedValue(mockResponse);

            await api.callLLM('message', [], {});

            expect(global.fetch).toHaveBeenCalledWith(
                'http://localhost:1234/v1/chat/completions',
                expect.any(Object)
            );
        });
    });

    describe('testConnection()', () => {
        it('should reply success on working connection', async () => {
            global.fetch.mockResolvedValue({ ok: true });

            const mockCtx = {
                reply: jest.fn()
            };

            await api.testConnection(mockCtx);

            expect(mockCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining('✅')
            );
        });

        it('should reply error on failed connection', async () => {
            global.fetch.mockRejectedValue(new Error('Connection failed'));

            const mockCtx = {
                reply: jest.fn()
            };

            await api.testConnection(mockCtx);

            expect(mockCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining('❌')
            );
        });
    });
});
