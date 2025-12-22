/**
 * Tests for middlewares/menu-ownership.js
 */

const { adminOnlyCallbacks, isAdminCached } = require('../../src/middlewares/menu-ownership');

describe('Menu Ownership Middleware', () => {
    describe('isAdminCached()', () => {
        it('should return false if no chat', async () => {
            const ctx = {
                chat: null,
                from: { id: 123 }
            };

            const result = await isAdminCached(ctx);
            expect(result).toBe(false);
        });

        it('should return false if no user', async () => {
            const ctx = {
                chat: { id: -100 },
                from: null
            };

            const result = await isAdminCached(ctx);
            expect(result).toBe(false);
        });

        it('should return true for admin', async () => {
            const ctx = {
                chat: { id: -100 },
                from: { id: 123 },
                getChatMember: jest.fn().mockResolvedValue({ status: 'administrator' })
            };

            const result = await isAdminCached(ctx);
            expect(result).toBe(true);
        });

        it('should return false for regular member', async () => {
            const ctx = {
                chat: { id: -100 },
                from: { id: 456 },
                getChatMember: jest.fn().mockResolvedValue({ status: 'member' })
            };

            const result = await isAdminCached(ctx);
            expect(result).toBe(false);
        });

        it('should return false on API error', async () => {
            const ctx = {
                chat: { id: -100 },
                from: { id: 789 },
                getChatMember: jest.fn().mockRejectedValue(new Error('API Error'))
            };

            const result = await isAdminCached(ctx);
            expect(result).toBe(false);
        });

        it('should cache results', async () => {
            const ctx = {
                chat: { id: -100 },
                from: { id: 111 },
                getChatMember: jest.fn().mockResolvedValue({ status: 'creator' })
            };

            await isAdminCached(ctx);
            await isAdminCached(ctx);

            // Should only call API once due to cache
            expect(ctx.getChatMember).toHaveBeenCalledTimes(1);
        });
    });

    describe('adminOnlyCallbacks()', () => {
        let middleware;
        let mockNext;

        beforeEach(() => {
            middleware = adminOnlyCallbacks();
            mockNext = jest.fn();
        });

        it('should call next for non-callback queries', async () => {
            const ctx = {
                callbackQuery: null
            };

            await middleware(ctx, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it('should call next for private chats', async () => {
            const ctx = {
                callbackQuery: { data: 'test' },
                chat: { type: 'private' }
            };

            await middleware(ctx, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it('should call next for whitelisted prefixes (vote_)', async () => {
            const ctx = {
                callbackQuery: { data: 'vote_123_ban' },
                chat: { type: 'supergroup', id: -100 },
                from: { id: 999 },
                getChatMember: jest.fn().mockResolvedValue({ status: 'member' })
            };

            await middleware(ctx, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it('should call next for whitelisted prefixes (wc:)', async () => {
            const ctx = {
                callbackQuery: { data: 'wc:123' },
                chat: { type: 'supergroup', id: -100 },
                from: { id: 999 },
                getChatMember: jest.fn().mockResolvedValue({ status: 'member' })
            };

            await middleware(ctx, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it('should block non-admin from config callbacks', async () => {
            const ctx = {
                callbackQuery: { data: 'config_spam' },
                chat: { type: 'supergroup', id: -100 },
                from: { id: 999 },
                getChatMember: jest.fn().mockResolvedValue({ status: 'member' }),
                answerCallbackQuery: jest.fn()
            };

            await middleware(ctx, mockNext);

            expect(mockNext).not.toHaveBeenCalled();
            expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
                text: expect.stringContaining('admin'),
                show_alert: true
            });
        });

        it('should allow admin for config callbacks', async () => {
            const ctx = {
                callbackQuery: { data: 'config_spam' },
                chat: { type: 'supergroup', id: -100 },
                from: { id: 123 },
                getChatMember: jest.fn().mockResolvedValue({ status: 'administrator' })
            };

            await middleware(ctx, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });
    });
});
