// Global test setup
// Suppress console output during tests unless DEBUG=true
if (process.env.DEBUG !== 'true') {
    global.console = {
        ...console,
        log: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        // Keep error for debugging failed tests
        error: console.error
    };
}

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.BOT_TOKEN = 'test-token';
process.env.POSTGRES_HOST = 'localhost';
process.env.POSTGRES_PORT = '5432';
process.env.POSTGRES_DB = 'test_db';
process.env.POSTGRES_USER = 'test';
process.env.POSTGRES_PASSWORD = 'test';

// Increase timeout for async operations
jest.setTimeout(10000);
