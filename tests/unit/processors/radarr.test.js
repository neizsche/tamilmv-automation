const radarrProcessor = require('../../../src/processors/radarr');
const radarrService = require('../../../src/services/radarr');
const { parseMovieName } = require('../../../src/utils/helpers');
const { log } = require('../../../src/utils/logger');

jest.mock('../../../src/services/radarr');
jest.mock('../../../src/utils/helpers', () => ({
    parseMovieName: jest.fn((name) => ({
        display: name.replace(/\./g, ' ').toUpperCase(),
        year: '2024',
        clean: name.replace(/\./g, ' '),
    })),
}));
jest.mock('../../../src/utils/logger');

describe('RadarrIntegration Processor', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('categorize', () => {
        it('should enable download if movie does not exist', async () => {
            const torrents = [{ name: 'Movie.1', size: 1024 ** 3 }];
            radarrService.checkMovieStatus.mockResolvedValue({ exists: false, hasFile: false });

            const { toStart, toDelete, movieProcessing } =
                await radarrProcessor.categorize(torrents);

            expect(toStart).toHaveLength(1);
            expect(toDelete).toHaveLength(0);
            expect(movieProcessing.get('MOVIE 1').addedToRadarr).toBe(true);
            expect(movieProcessing.get('MOVIE 1').downloading).toBe(true);
        });

        it('should enable download if movie exists but has no file', async () => {
            const torrents = [{ name: 'Movie.1', size: 1024 ** 3 }];
            radarrService.checkMovieStatus.mockResolvedValue({ exists: true, hasFile: false });

            const { toStart, toDelete, movieProcessing } =
                await radarrProcessor.categorize(torrents);

            expect(toStart).toHaveLength(1);
            expect(toDelete).toHaveLength(0);
            expect(movieProcessing.get('MOVIE 1').addedToRadarr).toBe(false);
            expect(movieProcessing.get('MOVIE 1').downloading).toBe(true);
        });

        it('should delete if movie exists and has file', async () => {
            const torrents = [{ name: 'Movie.1', size: 1024 ** 3 }];
            radarrService.checkMovieStatus.mockResolvedValue({ exists: true, hasFile: true });

            const { toStart, toDelete, movieProcessing } =
                await radarrProcessor.categorize(torrents);

            expect(toStart).toHaveLength(0);
            expect(toDelete).toHaveLength(1);
            expect(movieProcessing.has('MOVIE 1')).toBe(false);
        });

        it('should handle errors in checkStatus', async () => {
            const torrents = [{ name: 'Movie.1', size: 1024 ** 3 }];
            radarrService.checkMovieStatus.mockRejectedValue(new Error('API Error'));

            const { toStart, toDelete, movieProcessing } =
                await radarrProcessor.categorize(torrents);

            expect(toStart).toHaveLength(0);
            expect(toDelete).toHaveLength(0);
            expect(log.error).toHaveBeenCalled();
        });
    });

    describe('addMovies', () => {
        it('should add movies to Radarr', async () => {
            const torrentsToStart = [{ name: 'Movie.1' }];
            const movieProcessing = new Map();
            movieProcessing.set('MOVIE 1', { addedToRadarr: true });

            radarrService.addMovie.mockResolvedValue({ added: true });

            await radarrProcessor.addMovies(torrentsToStart, movieProcessing);

            expect(radarrService.addMovie).toHaveBeenCalledWith('Movie.1');
        });

        it('should handle failures adding to Radarr', async () => {
            const torrentsToStart = [{ name: 'Movie.1' }];
            const movieProcessing = new Map();
            movieProcessing.set('MOVIE 1', { addedToRadarr: true });

            radarrService.addMovie.mockRejectedValue(new Error('Add fail'));

            await radarrProcessor.addMovies(torrentsToStart, movieProcessing);

            expect(log.error).toHaveBeenCalled();
            expect(movieProcessing.get('MOVIE 1').addedToRadarr).toBe(false);
        });

        it('should handle case where movie already exists during add', async () => {
            const torrentsToStart = [{ name: 'Movie.1' }];
            const movieProcessing = new Map();
            movieProcessing.set('MOVIE 1', { addedToRadarr: true });

            radarrService.addMovie.mockResolvedValue({ exists: true });
            radarrService.checkMovieStatus.mockResolvedValue({ hasFile: true });

            await radarrProcessor.addMovies(torrentsToStart, movieProcessing);

            expect(movieProcessing.get('MOVIE 1').addedToRadarr).toBe(false);
            expect(movieProcessing.get('MOVIE 1').downloading).toBe(false);
        });
    });
});
