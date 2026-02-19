// Mock logger before requiring config
jest.mock('../../src/utils/logger', () => ({
    log: {
        error: jest.fn(),
        info: jest.fn(),
        warning: jest.fn(),
        success: jest.fn(),
        debug: jest.fn(),
    },
    setVerbose: jest.fn(),
}));

// Load env vars immediately so they are available for originalEnv snapshot
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

// Mock dotenv to prevent reloading during tests
jest.mock('dotenv', () => ({
    config: jest.fn(),
}));

describe('Config', () => {
    let originalEnv;
    let exitSpy;

    beforeAll(() => {
        originalEnv = { ...process.env };
    });

    beforeEach(() => {
        exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    });

    afterEach(() => {
        exitSpy.mockRestore();
    });

    afterAll(() => {
        process.env = { ...originalEnv };
    });

    describe('Custom Feed Configuration', () => {
        beforeEach(() => {
            jest.resetModules();
        });

        it('should include custom feed when CUSTOM_FEED_NAME and CUSTOM_FEED_PATH are set', () => {
            process.env.CUSTOM_FEED_NAME = 'my_custom_feed';
            process.env.CUSTOM_FEED_PATH = 'custom/path/to/feed.xml';

            const config = require('../../src/config');

            expect(config.FEEDS).toHaveProperty('my_custom_feed');
            expect(config.FEEDS.my_custom_feed).toBe('custom/path/to/feed.xml');

            // Cleanup
            delete process.env.CUSTOM_FEED_NAME;
            delete process.env.CUSTOM_FEED_PATH;
        });

        it('should not include custom feed if only CUSTOM_FEED_NAME is set', () => {
            process.env.CUSTOM_FEED_NAME = 'my_custom_feed';
            delete process.env.CUSTOM_FEED_PATH;

            const config = require('../../src/config');

            expect(config.FEEDS).not.toHaveProperty('my_custom_feed');

            // Cleanup
            delete process.env.CUSTOM_FEED_NAME;
        });

        it('should not include custom feed if only CUSTOM_FEED_PATH is set', () => {
            delete process.env.CUSTOM_FEED_NAME;
            process.env.CUSTOM_FEED_PATH = 'custom/path/to/feed.xml';

            const config = require('../../src/config');

            const feedKeys = Object.keys(config.FEEDS);
            expect(feedKeys).not.toContain('undefined');

            // Cleanup
            delete process.env.CUSTOM_FEED_PATH;
        });

        it('should provide default values for optional config', () => {
            const config = require('../../src/config');

            expect(config.RADARR_QUALITY_PROFILE_ID).toBeDefined();
            expect(config.TORRENT_SIZE.MIN_GB).toBeDefined();
            expect(config.TORRENT_SIZE.MAX_GB).toBeDefined();
            expect(config.QBITTORRENT.TAG).toBeDefined();
        });

        it('should parse env vars with correct types', () => {
            const config = require('../../src/config');

            expect(typeof config.RADARR_QUALITY_PROFILE_ID).toBe('number');
            expect(typeof config.TORRENT_SIZE.MIN_GB).toBe('number');
            expect(typeof config.TORRENT_SIZE.MAX_GB).toBe('number');
            expect(typeof config.CHECK_INTERVAL).toBe('number');
        });

        test.each([
            ['ENABLE_MALAYALAM_HD', 'malayalam_hd'],
            ['ENABLE_HINDI_HD', 'hindi_hd'],
            ['ENABLE_TAMIL_HD', 'tamil_hd'],
            ['ENABLE_TELUGU_HD', 'telugu_hd'],
            ['ENABLE_KANNADA_HD', 'kannada_hd'],
            ['ENABLE_ENGLISH_HD', 'english_hd'],
        ])('should enable %s feed when flag is true', (envVar, feedKey) => {
            process.env[envVar] = 'true';
            jest.resetModules();

            const config = require('../../src/config');

            expect(config.FEEDS).toHaveProperty(feedKey);
            delete process.env[envVar];
        });
    });

    describe('Validation', () => {
        let errorSpy;

        beforeEach(() => {
            const { log } = require('../../src/utils/logger');
            errorSpy = jest.spyOn(log, 'error');
        });

        afterEach(() => {
            errorSpy.mockRestore();
        });

        // prettier-ignore
        test.each([
            ['RADARR_URL'],
            ['RADARR_API_KEY'],
            ['RADARR_ROOT_FOLDER'],
        ])('should exit when required %s is missing', (envVar) => {
            const originalValue = process.env[envVar];
            delete process.env[envVar];

            // Use isolateModules to ensure fresh require
            jest.isolateModules(() => {
                require('../../src/config');
            });

            expect(exitSpy).toHaveBeenCalledWith(1);
            expect(errorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Missing required environment variables'),
            );

            // Restore
            if (originalValue !== undefined) {
                process.env[envVar] = originalValue;
            }
        });

        test.each([
            ['RADARR_URL', 'invalid-url'],
            ['QBITTORRENT_URL', 'ftp://invalid.com'],
            ['RADARR_URL', 'not a url at all'],
        ])('should exit when %s has invalid format: %s', (envVar, invalidValue) => {
            const originalValue = process.env[envVar];
            process.env[envVar] = invalidValue;

            jest.isolateModules(() => {
                require('../../src/config');
            });

            expect(exitSpy).toHaveBeenCalledWith(1);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid URL format'));

            // Restore
            if (originalValue !== undefined) {
                process.env[envVar] = originalValue;
            } else {
                delete process.env[envVar];
            }
        });

        it('should handle non-numeric RADARR_QUALITY_PROFILE_ID gracefully', () => {
            const originalValue = process.env.RADARR_QUALITY_PROFILE_ID;
            process.env.RADARR_QUALITY_PROFILE_ID = 'not-a-number';
            jest.resetModules();

            const config = require('../../src/config');

            // Falls back to default (1) because config uses `|| 1`
            expect(config.RADARR_QUALITY_PROFILE_ID).toBe(1);

            // Restore
            if (originalValue !== undefined) {
                process.env.RADARR_QUALITY_PROFILE_ID = originalValue;
            } else {
                delete process.env.RADARR_QUALITY_PROFILE_ID;
            }
        });

        it('should handle non-numeric MIN_SIZE_GB gracefully', () => {
            const originalValue = process.env.MIN_SIZE_GB;
            process.env.MIN_SIZE_GB = 'not-a-number';
            jest.resetModules();

            const config = require('../../src/config');

            // Falls back to default (1) because config uses `|| 1`
            expect(config.TORRENT_SIZE.MIN_GB).toBe(1);

            // Restore
            if (originalValue !== undefined) {
                process.env.MIN_SIZE_GB = originalValue;
            } else {
                delete process.env.MIN_SIZE_GB;
            }
        });
    });
});
