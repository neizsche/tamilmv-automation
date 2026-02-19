const {
    extractMovieName,
    parseMovieName,
    formatTorrentTitle,
    retryWithBackoff,
    ensureFolderExists,
    wait,
} = require('../../../src/utils/helpers');
const fs = require('fs');

jest.mock('fs');
jest.mock('../../../src/utils/logger', () => ({
    log: {
        warning: jest.fn(),
    },
}));

describe('Utils Helpers', () => {
    describe('extractMovieName', () => {
        it('should extract movie name from branded pattern', () => {
            const input = 'www.1TamilMV.cz - Movie Name (2024) 1080p HQ HDRip';
            const result = extractMovieName(input);
            expect(result).toBe('MOVIE NAME (2024)');
        });

        it('should fallback to start matching pattern', () => {
            const input = 'Movie Name (2024) 720p';
            const result = extractMovieName(input);
            expect(result).toBe('MOVIE NAME (2024)');
        });

        it('should return original name if no pattern matches', () => {
            const input = 'Random File Name';
            const result = extractMovieName(input);
            expect(result).toBe('Random File Name');
        });
    });

    describe('parseMovieName', () => {
        it('should parse movie name correctly from strict format', () => {
            const input = 'www.1TamilMV.cz - Movie Name (2024) 1080p';
            const { display, year, clean } = parseMovieName(input);
            expect(display).toBe('MOVIE NAME');
            expect(year).toBe('2024');
            expect(clean).toBe('Movie Name');
        });

        it('should handle names without the prefix', () => {
            const input = 'Movie Name (2024) 1080p';
            const { display, year, clean } = parseMovieName(input);
            expect(display).toBe('MOVIE NAME');
            expect(year).toBe('2024');
            expect(clean).toBe('Movie Name');
        });

        it('should handle names without year', () => {
            const input = 'Movie Name 1080p';
            const { display, year, clean } = parseMovieName(input);
            expect(display).toBe('MOVIE NAME 1080P');
            expect(year).toBe('');
            expect(clean).toBe('Movie Name 1080p');
        });
    });

    describe('formatTorrentTitle', () => {
        it('should extract title from forum url', () => {
            const url = 'https://example.com/forums/topic/123-movie-name-malayalam';
            expect(formatTorrentTitle(url)).toBe('movie-name');
        });

        it('should return original url if no match', () => {
            const url = 'https://example.com';
            expect(formatTorrentTitle(url)).toBe(url);
        });
    });

    describe('ensureFolderExists', () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should create folder if not exists', () => {
            // When existsSync returns false
            fs.existsSync.mockReturnValue(false);

            ensureFolderExists('/tmp/folder');

            expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/folder', { recursive: true });
        });

        it('should not create if exists', () => {
            // When existsSync returns true
            fs.existsSync.mockReturnValue(true);
            fs.mkdirSync.mockClear();

            ensureFolderExists('/tmp/folder');

            expect(fs.mkdirSync).not.toHaveBeenCalled();
        });
    });

    describe('retryWithBackoff', () => {
        it('should return result on first try', async () => {
            const fn = jest.fn().mockResolvedValue('success');
            const result = await retryWithBackoff(fn);
            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('should retry on failure', async () => {
            const fn = jest
                .fn()
                .mockRejectedValueOnce(new Error('Fail 1'))
                .mockResolvedValue('success');

            // Use small delay 1ms
            const start = Date.now();
            const result = await retryWithBackoff(fn, 3, 1, 'test op');
            const duration = Date.now() - start;

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(2);
            expect(duration).toBeGreaterThanOrEqual(1); // At least 1ms wait
        });

        it('should fail after max retries', async () => {
            const fn = jest.fn().mockRejectedValue(new Error('Fail'));

            await expect(retryWithBackoff(fn, 2, 1, 'test op')).rejects.toThrow('Fail');
            expect(fn).toHaveBeenCalledTimes(2);
        });
    });

    describe('wait', () => {
        it('should resolve after time', async () => {
            const start = Date.now();
            await wait(10);
            const end = Date.now();
            // In CI/Test env, 10ms might be slightly inaccurate but should be close.
            // Just verifying it resolves is mostly enough, or mocking setTimeout logic.
            // checks that it waited at least something.
            expect(end - start).toBeGreaterThanOrEqual(5);
        });
    });
});
