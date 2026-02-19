const orchestrator = require('../../../src/processors/orchestrator');
const qbittorrent = require('../../../src/services/qbittorrent');
const csvLogger = require('../../../src/utils/csvLogger');
const { log } = require('../../../src/utils/logger');
const downloader = require('../../../src/processors/downloader');
const scraper = require('../../../src/processors/scraper');
const filter = require('../../../src/processors/filter');
const radarrProcessor = require('../../../src/processors/radarr');

// Mock dependencies
jest.mock('fs');
jest.mock('path');
jest.mock('../../../src/config', () => ({
    TORRENT_FOLDER: '/tmp/torrents',
}));
jest.mock('../../../src/services/qbittorrent');
jest.mock('../../../src/utils/csvLogger');
jest.mock('../../../src/utils/helpers', () => ({
    wait: jest.fn().mockResolvedValue(),
    parseMovieName: jest.fn((name) => ({ display: name.toUpperCase(), year: '2024', clean: name })),
    ensureFolderExists: jest.fn(),
}));
jest.mock('../../../src/utils/logger');
jest.mock('../../../src/processors/downloader');
jest.mock('../../../src/processors/scraper');
jest.mock('../../../src/processors/filter');
jest.mock('../../../src/processors/radarr');

describe('TorrentOrchestrator', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('processSingle', () => {
        it('should download and add torrent successfully', async () => {
            const link = 'http://example.com/file.torrent';
            const fileName = 'file.torrent';
            downloader.generateFilename.mockReturnValue(fileName);
            downloader.download.mockResolvedValue(true);
            qbittorrent.addTorrent.mockResolvedValue(true);

            const result = await orchestrator.processSingle(link);

            expect(result).toBe(true);
            expect(downloader.download).toHaveBeenCalledWith(link, fileName);
            expect(qbittorrent.addTorrent).toHaveBeenCalled();
            expect(downloader.delete).toHaveBeenCalledWith(fileName);
        });

        it('should handle download failure', async () => {
            downloader.generateFilename.mockReturnValue('file.torrent');
            downloader.download.mockResolvedValue(false);

            const result = await orchestrator.processSingle('link');

            expect(result).toBe(false);
            expect(qbittorrent.addTorrent).not.toHaveBeenCalled();
            expect(downloader.delete).toHaveBeenCalled();
        });

        it('should handle add torrent failure', async () => {
            downloader.generateFilename.mockReturnValue('file.torrent');
            downloader.download.mockResolvedValue(true);
            qbittorrent.addTorrent.mockResolvedValue(false);

            const result = await orchestrator.processSingle('link');

            expect(result).toBe(false);
            expect(downloader.delete).toHaveBeenCalled();
        });

        it('should handle exceptions', async () => {
            downloader.generateFilename.mockReturnValue('file.torrent');
            downloader.download.mockRejectedValue(new Error('Download error'));

            const result = await orchestrator.processSingle('link');

            expect(result).toBe(false);
            expect(log.error).toHaveBeenCalled();
            expect(downloader.delete).toHaveBeenCalled();
        });
    });

    describe('_verifyStoppedTorrents', () => {
        it('should restart stopped torrents that should be running', async () => {
            qbittorrent.getTorrents.mockResolvedValue([
                { hash: 'hash1', name: 'Movie 1', state: 'stoppedUP' },
                { hash: 'hash2', name: 'Movie 2', state: 'downloading' },
            ]);
            qbittorrent.manageTorrents.mockResolvedValue(true);

            await orchestrator._verifyStoppedTorrents(['hash1', 'hash2']);

            expect(qbittorrent.getTorrents).toHaveBeenCalled();
            expect(qbittorrent.manageTorrents).toHaveBeenCalledWith(
                expect.arrayContaining([{ hash: 'hash1', name: 'Movie 1', state: 'stoppedUP' }]),
                'start'
            );
        });

        it('should do nothing if no hashes provided', async () => {
            await orchestrator._verifyStoppedTorrents([]);
            expect(qbittorrent.getTorrents).not.toHaveBeenCalled();
        });

        it('should do nothing if torrentHashes is null', async () => {
            await orchestrator._verifyStoppedTorrents(null);
            expect(qbittorrent.getTorrents).not.toHaveBeenCalled();
        });
    });

    describe('cleanUnwanted', () => {
        it('should categorize and manage torrents', async () => {
            const torrents = [{ hash: 'hash1' }];
            const remaining = [{ hash: 'hash1' }];
            const summary = { details: {}, initial: 1, remaining: 1 };

            qbittorrent.getTorrents.mockResolvedValue(torrents);
            filter.filterTorrents.mockResolvedValue({ remaining, summary });

            const toDelete = [];
            const toStart = [{ hash: 'hash1', name: 'Movie 1' }];
            const movieProcessing = new Map();
            movieProcessing.set('MOVIE 1', {
                addedToRadarr: true,
                downloading: true,
                name: 'Movie 1',
            });

            radarrProcessor.categorize.mockResolvedValue({ toDelete, toStart, movieProcessing });
            radarrProcessor.addMovies.mockResolvedValue();

            qbittorrent.manageTorrents.mockResolvedValue(true);

            const stats = await orchestrator.cleanUnwanted();

            expect(filter.filterTorrents).toHaveBeenCalledWith(torrents);
            expect(radarrProcessor.categorize).toHaveBeenCalledWith(remaining);
            expect(radarrProcessor.addMovies).toHaveBeenCalled();
            expect(qbittorrent.manageTorrents).toHaveBeenCalledWith(toStart, 'start');
            expect(stats.moviesStarted).toBe(1);
            // expect(csvLogger.logAdded).toHaveBeenCalled(); // logToCSV is commented out in code? No, line 139 calls it.
            // But logToCSV is called for torrentsToStart.
            expect(csvLogger.logAdded).toHaveBeenCalled();
        });

        it('should delete torrents if movie already exists in Radarr', async () => {
            const torrents = [{ hash: 'hash1', name: 'Movie 1' }];
            filter.filterTorrents.mockResolvedValue({
                remaining: torrents,
                summary: { details: {} },
            });

            const toStart = [{ hash: 'hash1', name: 'Movie 1' }];
            const movieProcessing = new Map();
            // Simulate movie exists and not downloading (already has file)
            movieProcessing.set('MOVIE 1', { addedToRadarr: false, downloading: false });

            radarrProcessor.categorize.mockResolvedValue({
                toDelete: [],
                toStart,
                movieProcessing,
            });

            await orchestrator.cleanUnwanted();

            expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Moving to delete'));
            expect(qbittorrent.manageTorrents).toHaveBeenCalledWith(
                expect.arrayContaining([{ hash: 'hash1', name: 'Movie 1' }]),
                'delete',
                expect.stringContaining('movie file already available')
            );
        });

        it('should handle errors gracefully', async () => {
            qbittorrent.getTorrents.mockRejectedValue(new Error('Fetch error'));

            const stats = await orchestrator.cleanUnwanted();

            expect(log.error).toHaveBeenCalled();
            expect(stats.moviesAdded).toBe(0);
        });
    });
    describe('_cleanupOrphanedStoppedTorrents', () => {
        it('should delete orphaned torrents if movie file exists in Radarr', async () => {
            const torrents = [{ hash: 'hash1' }];
            qbittorrent.getTorrents.mockResolvedValue(torrents);
            radarrProcessor._checkStatus.mockResolvedValue({
                movieStatus: { exists: true, hasFile: true },
            });

            await orchestrator._cleanupOrphanedStoppedTorrents();

            expect(qbittorrent.manageTorrents).toHaveBeenCalledWith(
                torrents,
                'delete',
                expect.stringContaining('orphaned')
            );
        });
    });

    describe('processNew', () => {
        it('should process new items successfully', async () => {
            const items = [{ link: 'http://example.com' }];
            scraper.scrapeAll.mockResolvedValue(['magnet:?xt=urn:btih:hash']);

            // Mock processSingle to return true
            // Since processSingle is a method on the instance, we can spy on it?
            // But we are testing the instance methods directly.
            // processNew calls this.processSingle.
            // We can mock processSingle on the orchestrator instance if we want to isolate processNew logic.
            // But orchestrator is the SUT (System Under Test).
            // We can mock implementation of processSingle using spyOn.
            const processSingleSpy = jest
                .spyOn(orchestrator, 'processSingle')
                .mockResolvedValue(true);

            radarrProcessor.filterItems.mockResolvedValue(items);
            qbittorrent.getTorrents.mockResolvedValue([{ hash: 'hash' }]);

            // Mock cleanUnwanted
            const cleanSpy = jest.spyOn(orchestrator, 'cleanUnwanted').mockResolvedValue({
                moviesAdded: 1,
                moviesStarted: 1,
                filterSummary: { details: {}, initial: 1, remaining: 1 },
            });

            const stats = await orchestrator.processNew(items);

            expect(scraper.scrapeAll).toHaveBeenCalledWith(items, 200);
            expect(processSingleSpy).toHaveBeenCalled();
            expect(cleanSpy).toHaveBeenCalled();
            expect(cleanSpy).toHaveBeenCalled();
            expect(stats.moviesAdded).toBe(1);
            expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Scraping 1 item(s)'));
            expect(log.debug).toHaveBeenCalledWith(
                expect.stringContaining('Added 1/1 to qBittorrent')
            );
            expect(downloader.cleanupOrphaned).toHaveBeenCalled();

            processSingleSpy.mockRestore();
            cleanSpy.mockRestore();
        });

        it('should handle errors', async () => {
            scraper.scrapeAll.mockRejectedValue(new Error('Scrape error'));

            const stats = await orchestrator.processNew([]);

            expect(log.error).toHaveBeenCalled();
            expect(stats.torrents).toBe(0);
        });
    });
});
