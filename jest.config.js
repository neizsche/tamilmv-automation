module.exports = {
    testEnvironment: 'node',

    collectCoverage: false,
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov'],
    setupFilesAfterEnv: ['./tests/setup.js'],
    verbose: true,
};
