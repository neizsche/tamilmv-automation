// Mock the logger to prevent noise during tests
jest.mock('../src/utils/logger', () => ({
    log: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        warning: jest.fn(),
    },
}));
