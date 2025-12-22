/**
 * Tests for middlewares/isAdmin.js
 */

const isAdmin = require('../../src/middlewares/isAdmin');

describe('isAdmin Middleware', () => {
    let mockCtx;
    let mockNext;

    beforeEach(() => {
        mockNext = jest.fn();
        mockCtx = {
            from: { id: 123 },
            chat: { id: -100123, type: 'supergroup' },
            getChatMember: jest.fn()
        };
    });

    it('should call next() for creator', async () => {
        mockCtx.getChatMember.mockResolvedValue({ status: 'creator' });

        await isAdmin(mockCtx, mockNext);
        expect(mockNext).toHaveBeenCalled();
    });

    it('should call next() for administrator', async () => {
        mockCtx.getChatMember.mockResolvedValue({ status: 'administrator' });

        await isAdmin(mockCtx, mockNext);
        expect(mockNext).toHaveBeenCalled();
    });

    it('should NOT call next() for member', async () => {
        mockCtx.getChatMember.mockResolvedValue({ status: 'member' });

        await isAdmin(mockCtx, mockNext);
        expect(mockNext).not.toHaveBeenCalled();
    });

    it('should NOT call next() for restricted user', async () => {
        mockCtx.getChatMember.mockResolvedValue({ status: 'restricted' });

        await isAdmin(mockCtx, mockNext);
        expect(mockNext).not.toHaveBeenCalled();
    });

    it('should NOT call next() on API error', async () => {
        mockCtx.getChatMember.mockRejectedValue(new Error('API error'));

        await isAdmin(mockCtx, mockNext);
        expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next() for private chats', async () => {
        mockCtx.chat.type = 'private';

        await isAdmin(mockCtx, mockNext);
        expect(mockNext).toHaveBeenCalled();
        expect(mockCtx.getChatMember).not.toHaveBeenCalled();
    });

    it('should call next() if no from or chat', async () => {
        mockCtx.from = null;

        await isAdmin(mockCtx, mockNext);
        expect(mockNext).toHaveBeenCalled();
    });
});
