/**
 * Tests for utils/feature-flags.js
 */

const { isEnabled, flags } = require('../../src/utils/feature-flags');

describe('Feature Flags', () => {
    describe('flags object', () => {
        it('should have all core modules defined', () => {
            expect(flags.userReputation).toBeDefined();
            expect(flags.casBan).toBeDefined();
            expect(flags.adminLogger).toBeDefined();
            expect(flags.staffCoordination).toBeDefined();
            expect(flags.superAdmin).toBeDefined();
            expect(flags.intelNetwork).toBeDefined();
        });

        it('should have all detection modules defined', () => {
            expect(flags.antiSpam).toBeDefined();
            expect(flags.keywordMonitor).toBeDefined();
            expect(flags.languageMonitor).toBeDefined();
            expect(flags.modalPatterns).toBeDefined();
            expect(flags.linkMonitor).toBeDefined();
            expect(flags.aiModeration).toBeDefined();
            expect(flags.antiEditAbuse).toBeDefined();
            expect(flags.intelligentProfiler).toBeDefined();
            expect(flags.nsfwMonitor).toBeDefined();
            expect(flags.visualImmuneSystem).toBeDefined();
        });

        it('should have community modules defined', () => {
            expect(flags.voteBan).toBeDefined();
            expect(flags.welcomeSystem).toBeDefined();
            expect(flags.settingsMenu).toBeDefined();
        });
    });

    describe('isEnabled()', () => {
        it('should return true for enabled features', () => {
            // These should be enabled by default based on the source file
            expect(isEnabled('userReputation')).toBe(true);
            expect(isEnabled('casBan')).toBe(true);
            expect(isEnabled('voteBan')).toBe(true);
            expect(isEnabled('settingsMenu')).toBe(true);
        });

        it('should return false for disabled features', () => {
            // These should be disabled by default
            expect(isEnabled('intelNetwork')).toBe(false);
            expect(isEnabled('antiSpam')).toBe(false);
            expect(isEnabled('intelligentProfiler')).toBe(false);
            expect(isEnabled('visualImmuneSystem')).toBe(false);
        });

        it('should return false for undefined features', () => {
            expect(isEnabled('nonExistentFeature')).toBeFalsy();
        });
    });

    describe('default states', () => {
        it('should have sensible defaults for production', () => {
            // Critical security features should be enabled
            expect(flags.casBan).toBe(true);
            expect(flags.userReputation).toBe(true);
            expect(flags.adminLogger).toBe(true);

            // Potentially problematic features should be disabled
            expect(flags.antiSpam).toBe(false); // Can cause false positives
            expect(flags.intelNetwork).toBe(false); // Requires network setup
        });
    });
});
