module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.js'],
    collectCoverageFrom: [
        'src/**/*.js',
        '!src/**/index.js',
        '!src/**/commands.js',
        '!src/**/ui.js',
        '!src/**/wizard.js',
        '!src/**/core.js',
        '!src/middlewares/logger.js',
        '!src/database/backup.js',
        '!src/database/schema.js',
        '!src/database/migrations.js'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    // Note: Thresholds are low because we're only testing logic/detection layers
    // UI, commands, and core modules require integration testing
    coverageThreshold: {
        global: {
            branches: 10,
            functions: 10,
            lines: 10,
            statements: 10
        }
    },
    testTimeout: 10000,
    verbose: true,
    modulePathIgnorePatterns: ['<rootDir>/node_modules/'],
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
    forceExit: true
};
