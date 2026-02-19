const radarr = require('../../../src/services/radarr');
const axios = require('axios');
const config = require('../../../src/config');
const { log } = require('../../../src/utils/logger');
const notifier = require('../../../src/services/notifier');

jest.mock('axios');
jest.mock('../../../src/config', () => ({
    RADARR_URL: 'http://radarr',
    RADARR_API_KEY: 'apikey',
    RADARR_QUALITY_PROFILE_ID: 1,
    RADARR_ROOT_FOLDER: '/movies',
}));
jest.mock('../../../src/utils/logger');
jest.mock('../../../src/services/notifier');
jest.mock('../../../src/utils/helpers', () => ({
    extractMovieName: jest.fn((name) => name.replace(/\./g, ' ')),
    retryWithBackoff: jest.fn(async (fn) => await fn()),
}));

describe('RadarrClient', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('addMovie', () => {
        it('should add movie successfully', async () => {
            axios.get.mockImplementation((url) => {
                if (url.includes('/movie/lookup')) {
                    return Promise.resolve({
                        data: [
                            {
                                title: 'Movie',
                                year: 2024,
                                tmdbId: 123,
                                titleSlug: 'movie-2024',
                                images: [],
                            },
                        ],
                    });
                }
                if (url.endsWith('/movie') && !url.includes('lookup')) {
                    return Promise.resolve({ data: [] });
                }
                return Promise.resolve({ data: [] });
            });

            axios.post.mockResolvedValue({ data: { title: 'Movie', id: 1 } });

            notifier.notifyMovieAdded.mockResolvedValue(true);

            const result = await radarr.addMovie('Movie.2024');

            expect(result).toBeDefined();
            expect(result.added).toBe(true);
            expect(axios.post).toHaveBeenCalledTimes(1);
        });

        it('should handle movie not found', async () => {
            axios.get.mockImplementation((url) => {
                return Promise.resolve({ data: [] });
            });

            const result = await radarr.addMovie('Unknown.Movie');

            expect(result).toBeUndefined();
            // log.warning checked by checking calls is fine, but maybe redundant if we focus on return
        });

        it('should handle movie already exists (lookup)', async () => {
            axios.get.mockImplementation((url) => {
                if (url.includes('/movie/lookup')) {
                    return Promise.resolve({ data: [{ title: 'Movie', added: '2024-01-01' }] });
                }
                return Promise.resolve({ data: [] });
            });

            const result = await radarr.addMovie('Movie.2024');

            expect(result.exists).toBe(true);
            expect(result.added).toBe(false);
        });

        it('should handle movie already exists (by ID)', async () => {
            axios.get.mockImplementation((url) => {
                if (url.includes('/movie/lookup')) {
                    return Promise.resolve({ data: [{ title: 'Movie', tmdbId: 123 }] });
                }
                if (url.endsWith('/movie')) {
                    return Promise.resolve({ data: [{ title: 'Movie', tmdbId: 123, id: 1 }] });
                }
                return Promise.resolve({ data: [] });
            });

            const result = await radarr.addMovie('Movie.2024');

            expect(result.exists).toBe(true);
            expect(result.added).toBe(false);
        });

        it('should handle error during add', async () => {
            axios.get.mockResolvedValueOnce({ data: [{ title: 'Movie', tmdbId: 123 }] }); // Lookup
            axios.get.mockResolvedValueOnce({ data: [] }); // Check exists by ID
            axios.post.mockRejectedValue(new Error('Add fail'));

            const result = await radarr.addMovie('Movie.2024');

            expect(result.added).toBe(false);
            expect(log.error).toHaveBeenCalled();
        });
    });

    describe('checkMovieStatus', () => {
        it('should return status if movie exists', async () => {
            axios.get.mockResolvedValueOnce({ data: [{ title: 'Movie', tmdbId: 123 }] }); // Lookup
            axios.get.mockResolvedValueOnce({
                data: [{ title: 'Movie', tmdbId: 123, hasFile: true }],
            }); // Check library

            const status = await radarr.checkMovieStatus('Movie.2024');

            expect(status.exists).toBe(true);
            expect(status.hasFile).toBe(true);
        });

        it('should return false if movie not found in lookup', async () => {
            axios.get.mockResolvedValueOnce({ data: [] });

            const status = await radarr.checkMovieStatus('Unknown');

            expect(status.exists).toBe(false);
        });

        it('should return false if movie not found in library', async () => {
            axios.get.mockResolvedValueOnce({ data: [{ title: 'Movie', tmdbId: 123 }] }); // Lookup
            axios.get.mockResolvedValueOnce({ data: [] }); // Check library (returns array of all movies usually, but mock returns empty or list without ours)
            // Wait, the implementation fetches all movies? No, it fetches /api/v3/movie without ID to get all?
            // Implementation: axios.get(`${config.RADARR_URL}/api/v3/movie`, ... )
            // It doesn't pass query params to filter by ID in the GET /movie call unless I missed it.
            // Code: const existingMovie = existingResponse.data.find((m) => m.tmdbId === movieData.tmdbId);
            // So it fetches ALL movies.
            // My mock returns empty array, so find returns undefined.

            const status = await radarr.checkMovieStatus('Movie.2024');

            expect(status.exists).toBe(false);
        });
    });
});
