/**
 * Tests for utils/error-handlers.js
 */

const {
    handleTelegramError,
    handleCriticalError,
    safeJsonParse,
    safeDelete,
    safeEdit,
    safeBan,
    safeGetChatMember,
    isAdmin,
    isFromSettingsMenu,
    isSuperAdmin
} = require('../../src/utils/error-handlers');

describe('Error Handlers', () => {
    describe('safeJsonParse()', () => {
        it('should parse valid JSON', () => {
            const result = safeJsonParse('{"key": "value"}');
            expect(result).toEqual({ key: 'value' });
        });

        it('should return fallback for invalid JSON', () => {
            const result = safeJsonParse('not json', { default: true });
            expect(result).toEqual({ default: true });
        });

        it('should return null as default fallback', () => {
            const result = safeJsonParse('invalid');
            expect(result).toBeNull();
        });

        it('should parse arrays', () => {
            const result = safeJsonParse('[1, 2, 3]');
            expect(result).toEqual([1, 2, 3]);
        });
    });

    describe('safeDelete()', () => {
        it('should return true on success', async () => {
            const ctx = {
                deleteMessage: jest.fn().mockResolvedValue(true)
            };

            const result = await safeDelete(ctx, 'test');

            expect(result).toBe(true);
            expect(ctx.deleteMessage).toHaveBeenCalled();
        });

        it('should return false and not throw on error', async () => {
            const ctx = {
                deleteMessage: jest.fn().mockRejectedValue(new Error('Message not found'))
            };

            const result = await safeDelete(ctx, 'test');

            expect(result).toBe(false);
        });
    });

    describe('safeEdit()', () => {
        it('should return true on success', async () => {
            const ctx = {
                editMessageText: jest.fn().mockResolvedValue(true)
            };

            const result = await safeEdit(ctx, 'New text', {}, 'test');

            expect(result).toBe(true);
            expect(ctx.editMessageText).toHaveBeenCalledWith('New text', {});
        });

        it('should return false on error', async () => {
            const ctx = {
                editMessageText: jest.fn().mockRejectedValue(new Error('Message not modified'))
            };

            const result = await safeEdit(ctx, 'text', {}, 'test');

            expect(result).toBe(false);
        });
    });

    describe('safeBan()', () => {
        it('should return true on success', async () => {
            const ctx = {
                banChatMember: jest.fn().mockResolvedValue(true)
            };

            const result = await safeBan(ctx, 123, 'test');

            expect(result).toBe(true);
            expect(ctx.banChatMember).toHaveBeenCalledWith(123);
        });

        it('should return false on error', async () => {
            const ctx = {
                banChatMember: jest.fn().mockRejectedValue(new Error('Not enough rights'))
            };

            const result = await safeBan(ctx, 123, 'test');

            expect(result).toBe(false);
        });
    });

    describe('safeGetChatMember()', () => {
        it('should return member on success', async () => {
            const member = { status: 'administrator' };
            const ctx = {
                getChatMember: jest.fn().mockResolvedValue(member)
            };

            const result = await safeGetChatMember(ctx, 123, 'test');

            expect(result).toEqual(member);
        });

        it('should return null on error', async () => {
            const ctx = {
                getChatMember: jest.fn().mockRejectedValue(new Error('User not found'))
            };

            const result = await safeGetChatMember(ctx, 123, 'test');

            expect(result).toBeNull();
        });
    });

    describe('isAdmin()', () => {
        it('should return true for creator', async () => {
            const ctx = {
                from: { id: 123 },
                getChatMember: jest.fn().mockResolvedValue({ status: 'creator' })
            };

            const result = await isAdmin(ctx, 'test');

            expect(result).toBe(true);
        });

        it('should return true for administrator', async () => {
            const ctx = {
                from: { id: 123 },
                getChatMember: jest.fn().mockResolvedValue({ status: 'administrator' })
            };

            const result = await isAdmin(ctx, 'test');

            expect(result).toBe(true);
        });

        it('should return false for member', async () => {
            const ctx = {
                from: { id: 123 },
                getChatMember: jest.fn().mockResolvedValue({ status: 'member' })
            };

            const result = await isAdmin(ctx, 'test');

            expect(result).toBe(false);
        });

        it('should return false on error', async () => {
            const ctx = {
                from: { id: 123 },
                getChatMember: jest.fn().mockRejectedValue(new Error('Error'))
            };

            const result = await isAdmin(ctx, 'test');

            expect(result).toBe(false);
        });
    });

    describe('isFromSettingsMenu()', () => {
        it('should return true if settings_main button exists', () => {
            const ctx = {
                callbackQuery: {
                    message: {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: 'Back', callback_data: 'settings_main' }]
                            ]
                        }
                    }
                }
            };

            expect(isFromSettingsMenu(ctx)).toBe(true);
        });

        it('should return false if no settings_main button', () => {
            const ctx = {
                callbackQuery: {
                    message: {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: 'Other', callback_data: 'other' }]
                            ]
                        }
                    }
                }
            };

            expect(isFromSettingsMenu(ctx)).toBe(false);
        });

        it('should return false if no reply_markup', () => {
            const ctx = {
                callbackQuery: {
                    message: {}
                }
            };

            expect(isFromSettingsMenu(ctx)).toBe(false);
        });

        it('should return false if no callbackQuery', () => {
            expect(isFromSettingsMenu({})).toBe(false);
        });
    });

    describe('isSuperAdmin()', () => {
        const originalEnv = process.env.SUPER_ADMIN_IDS;

        afterEach(() => {
            process.env.SUPER_ADMIN_IDS = originalEnv;
        });

        it('should return true for configured super admin', () => {
            process.env.SUPER_ADMIN_IDS = '123,456,789';

            expect(isSuperAdmin(123)).toBe(true);
            expect(isSuperAdmin(456)).toBe(true);
            expect(isSuperAdmin(789)).toBe(true);
        });

        it('should return false for non-super admin', () => {
            process.env.SUPER_ADMIN_IDS = '123,456';

            expect(isSuperAdmin(999)).toBe(false);
        });

        it('should return false if no super admins configured', () => {
            process.env.SUPER_ADMIN_IDS = '';

            expect(isSuperAdmin(123)).toBe(false);
        });

        it('should handle malformed input', () => {
            process.env.SUPER_ADMIN_IDS = '123, abc, 456';

            expect(isSuperAdmin(123)).toBe(true);
            expect(isSuperAdmin(456)).toBe(true);
        });
    });

    describe('handleTelegramError()', () => {
        it('should not throw', () => {
            expect(() => {
                handleTelegramError('module', 'action', new Error('test'));
            }).not.toThrow();
        });

        it('should handle context info', () => {
            const ctx = { from: { id: 123 }, chat: { id: -100 } };
            expect(() => {
                handleTelegramError('module', 'action', new Error('test'), ctx);
            }).not.toThrow();
        });
    });

    describe('handleCriticalError()', () => {
        it('should not throw', () => {
            expect(() => {
                handleCriticalError('module', 'action', new Error('critical'));
            }).not.toThrow();
        });

        it('should handle context with chat title', () => {
            const ctx = { from: { id: 123 }, chat: { id: -100, title: 'Test Group' } };
            expect(() => {
                handleCriticalError('module', 'action', new Error('critical'), ctx);
            }).not.toThrow();
        });
    });
});
