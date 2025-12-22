/**
 * Tests for nsfw-monitor/actions.js
 */

// Mock all dependencies
jest.mock('../../../src/features/admin-logger', () => ({
    getLogEvent: jest.fn().mockReturnValue(null)
}));

jest.mock('../../../src/features/user-reputation', () => ({
    modifyFlux: jest.fn(),
    getLocalFlux: jest.fn().mockReturnValue(50)
}));

jest.mock('../../../src/features/super-admin', () => ({
    forwardMediaToParliament: jest.fn().mockResolvedValue(true),
    forwardBanToParliament: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../../src/features/staff-coordination', () => ({
    reviewQueue: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../../src/utils/error-handlers', () => ({
    safeDelete: jest.fn().mockResolvedValue(true),
    safeBan: jest.fn().mockResolvedValue(true)
}));

const { executeAction } = require('../../../src/features/nsfw-monitor/actions');
const errorHandlers = require('../../../src/utils/error-handlers');
const adminLogger = require('../../../src/features/admin-logger');
const superAdmin = require('../../../src/features/super-admin');
const staffCoordination = require('../../../src/features/staff-coordination');
const userReputation = require('../../../src/features/user-reputation');

describe('NSFW Monitor Actions', () => {
    const mockCtx = {
        from: { id: 123, first_name: 'TestUser', username: 'testuser' },
        chat: { id: -100123, title: 'Test Group' },
        message: { message_id: 456 }
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('executeAction()', () => {
        describe('delete action', () => {
            it('should forward to parliament and delete message', async () => {
                await executeAction(mockCtx, 'delete', 'Nudity detected', 'photo');

                expect(superAdmin.forwardMediaToParliament).toHaveBeenCalledWith(
                    'image_spam',
                    mockCtx,
                    expect.stringContaining('DELETE')
                );
                expect(errorHandlers.safeDelete).toHaveBeenCalledWith(mockCtx, 'nsfw-monitor');
            });

            it('should log event if logger available', async () => {
                const mockLogEvent = jest.fn();
                adminLogger.getLogEvent.mockReturnValue(mockLogEvent);

                await executeAction(mockCtx, 'delete', 'Nudity', 'photo');

                expect(mockLogEvent).toHaveBeenCalledWith(
                    expect.objectContaining({
                        eventType: 'nsfw_delete',
                        guildId: -100123
                    })
                );
            });
        });

        describe('ban action', () => {
            it('should delete and ban user', async () => {
                await executeAction(mockCtx, 'ban', 'Porn detected', 'video');

                expect(errorHandlers.safeDelete).toHaveBeenCalled();
                expect(errorHandlers.safeBan).toHaveBeenCalledWith(mockCtx, 123, 'nsfw-monitor');
            });

            it('should forward media and ban to parliament', async () => {
                await executeAction(mockCtx, 'ban', 'NSFW', 'photo');

                expect(superAdmin.forwardMediaToParliament).toHaveBeenCalledWith(
                    'image_spam',
                    mockCtx,
                    expect.stringContaining('BAN')
                );
                expect(superAdmin.forwardBanToParliament).toHaveBeenCalledWith(
                    expect.objectContaining({
                        user: mockCtx.from,
                        reason: expect.stringContaining('NSFW')
                    })
                );
            });

            it('should reduce user reputation', async () => {
                await executeAction(mockCtx, 'ban', 'NSFW content', 'photo');

                expect(userReputation.modifyFlux).toHaveBeenCalledWith(123, -100123, -100, 'nsfw_ban');
            });

            it('should not reduce reputation if ban fails', async () => {
                errorHandlers.safeBan.mockResolvedValue(false);

                await executeAction(mockCtx, 'ban', 'NSFW', 'photo');

                expect(userReputation.modifyFlux).not.toHaveBeenCalled();
            });
        });

        describe('report_only action', () => {
            it('should send to staff review queue', async () => {
                await executeAction(mockCtx, 'report_only', 'Suspicious content', 'animation');

                expect(staffCoordination.reviewQueue).toHaveBeenCalledWith({
                    guildId: -100123,
                    source: 'NSFW-Mon',
                    user: mockCtx.from,
                    reason: 'Suspicious content',
                    messageId: 456,
                    content: '[Media animation]'
                });
            });

            it('should not delete message', async () => {
                await executeAction(mockCtx, 'report_only', 'Test', 'photo');

                expect(errorHandlers.safeDelete).not.toHaveBeenCalled();
            });
        });
    });
});
