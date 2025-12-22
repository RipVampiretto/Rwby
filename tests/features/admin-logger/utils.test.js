/**
 * Tests for admin-logger/utils.js
 */

const { isAdmin, MODULE_MAP, EMOJI_MAP } = require('../../../src/features/admin-logger/utils');

describe('Admin Logger Utils', () => {
    describe('isAdmin()', () => {
        it('should return true for creator', async () => {
            const ctx = {
                from: { id: 123 },
                getChatMember: jest.fn().mockResolvedValue({ status: 'creator' })
            };

            const result = await isAdmin(ctx);
            expect(result).toBe(true);
        });

        it('should return true for administrator', async () => {
            const ctx = {
                from: { id: 123 },
                getChatMember: jest.fn().mockResolvedValue({ status: 'administrator' })
            };

            const result = await isAdmin(ctx);
            expect(result).toBe(true);
        });

        it('should return false for member', async () => {
            const ctx = {
                from: { id: 123 },
                getChatMember: jest.fn().mockResolvedValue({ status: 'member' })
            };

            const result = await isAdmin(ctx);
            expect(result).toBe(false);
        });

        it('should return false on error', async () => {
            const ctx = {
                from: { id: 123 },
                getChatMember: jest.fn().mockRejectedValue(new Error('API Error'))
            };

            const result = await isAdmin(ctx);
            expect(result).toBe(false);
        });
    });

    describe('MODULE_MAP', () => {
        it('should have language monitor mappings', () => {
            expect(MODULE_MAP['lang_delete']).toBe('Language Monitor');
            expect(MODULE_MAP['lang_ban']).toBe('Language Monitor');
        });

        it('should have NSFW monitor mappings', () => {
            expect(MODULE_MAP['nsfw_delete']).toBe('NSFW Monitor');
            expect(MODULE_MAP['nsfw_ban']).toBe('NSFW Monitor');
        });

        it('should have AI moderation mappings', () => {
            expect(MODULE_MAP['ai_delete']).toBe('AI Moderation');
            expect(MODULE_MAP['ai_ban']).toBe('AI Moderation');
        });

        it('should have staff coordination mappings', () => {
            expect(MODULE_MAP['staff_ban']).toBe('Staff Coordination');
            expect(MODULE_MAP['staff_dismiss']).toBe('Staff Coordination');
        });

        it('should have vote ban mapping', () => {
            expect(MODULE_MAP['vote_ban']).toBe('Vote Ban');
        });
    });

    describe('EMOJI_MAP', () => {
        it('should have emoji for each event type', () => {
            expect(EMOJI_MAP['lang_delete']).toBe('🌐');
            expect(EMOJI_MAP['nsfw_delete']).toBe('🔞');
            expect(EMOJI_MAP['link_delete']).toBe('🔗');
            expect(EMOJI_MAP['ai_delete']).toBe('🤖');
            expect(EMOJI_MAP['keyword_delete']).toBe('🔤');
            expect(EMOJI_MAP['staff_ban']).toBe('👮');
            expect(EMOJI_MAP['vote_ban']).toBe('⚖️');
        });
    });
});
