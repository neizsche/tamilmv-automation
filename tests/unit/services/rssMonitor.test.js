const rssMonitor = require('../../../src/services/rssMonitor');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../../../src/config');
const orchestrator = require('../../../src/processors/orchestrator');
const notifier = require('../../../src/services/notifier');
const domainResolver = require('../../../src/services/domainResolver');
// const qbittorrent = require('../../../src/services/qbittorrent'); // It is required dynamically

// Mock dependencies
jest.mock('axios');
jest.mock('fs');
jest.mock('path');
jest.mock('../../../src/config', () => ({
    FEED_FOLDER: '/tmp/feeds',
    FEEDS: {
        test_feed: 'feed_path.xml',
    },
    CHECK_INTERVAL: 60000,
    TAMILMV_DOMAINS: ['http://domain1.com'],
}));
jest.mock('../../../src/processors/orchestrator');
jest.mock('../../../src/utils/logger');
jest.mock('../../../src/services/notifier');
jest.mock('../../../src/services/domainResolver');
jest.mock('../../../src/utils/helpers', () => ({
    ensureFolderExists: jest.fn(),
}));
jest.mock('../../../src/services/qbittorrent', () => ({
    cleanupCompletedTorrents: jest.fn(),
}));

describe('RSSMonitor', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        path.join.mockImplementation((...args) => args.join('/'));
    });

    describe('initializeLastPubDate', () => {
        it('should return date minus days if ignoreFeed is true', () => {
            const date = rssMonitor.initializeLastPubDate('test_feed', true, 2);
            const now = new Date();
            // Allow small difference
            expect(now.getDate() - date.getDate()).toBeLessThanOrEqual(3); // considering month boundaries logic usually works with getTime
            // Better check:
            const expected = new Date();
            expected.setDate(expected.getDate() - 2);
            expect(date.toDateString()).toBe(expected.toDateString());
        });

        it('should return date minus days if file does not exist', () => {
            fs.existsSync.mockReturnValue(false);
            const date = rssMonitor.initializeLastPubDate('test_feed', false, 2);
            const expected = new Date();
            expected.setDate(expected.getDate() - 2);
            expect(date.toDateString()).toBe(expected.toDateString());
        });

        it('should return latest item date from file', () => {
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(
                '<rss><channel><item><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item></channel></rss>'
            );
            // Note: RSSMonitor uses this.parser which is fast-xml-parser.
            // We are not mocking fast-xml-parser, so it should work if we provide valid XML.
            // Wait, RSSMonitor constructor initializes parser.
            // We need to ensure we don't mock it out or if we do, we mock parse.
            // I didn't mock fast-xml-parser in jest.mock above, so it uses real one.

            const date = rssMonitor.initializeLastPubDate('test_feed', false, 2);
            expect(date.toISOString()).toBe(
                new Date('Mon, 01 Jan 2024 00:00:00 GMT').toISOString()
            );
        });

        it('should handle XML parsing error', () => {
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue('invalid xml');
            // fast-xml-parser might not throw but return empty object or structure.
            // If it throws or returns structure that breaks access logic, catch block in initializeLastPubDate handles it.

            const date = rssMonitor.initializeLastPubDate('test_feed', false, 2);
            const expected = new Date();
            expected.setDate(expected.getDate() - 30);
            expect(date.toDateString()).toBe(expected.toDateString());
        });
    });

    describe('checkRSSFeed', () => {
        it('should fetch and process feed successfully', async () => {
            domainResolver.resolve.mockResolvedValue('https://1tamilmv.cz');
            domainResolver.getUrl.mockReturnValue('https://1tamilmv.cz/feed.xml');
            axios.get.mockResolvedValue({
                data: '<rss><channel><item><pubDate>Wed, 01 Jan 2025 00:00:00 GMT</pubDate></item></channel></rss>',
            });

            // Mock file operations for atomic write
            fs.writeFileSync.mockImplementation(() => {});
            fs.renameSync.mockImplementation(() => {});
            fs.readFileSync.mockReturnValue(
                '<rss><channel><item><pubDate>Wed, 01 Jan 2025 00:00:00 GMT</pubDate></item></channel></rss>'
            );

            // Set last pub date to past
            rssMonitor.lastPubDates['test_feed'] = new Date('2024-01-01');

            orchestrator.processNew.mockResolvedValue({
                items: 1,
                torrents: 1,
                moviesAdded: 1,
                moviesStarted: 1,
                filterSummary: 'summary',
            });

            await rssMonitor.checkRSSFeed('test_feed', 'feed_path.xml');

            expect(domainResolver.resolve).toHaveBeenCalled();
            expect(axios.get).toHaveBeenCalled();
            expect(fs.writeFileSync).toHaveBeenCalled();
            expect(orchestrator.processNew).toHaveBeenCalled();
            expect(rssMonitor.lastPubDates['test_feed'].toISOString()).toBe(
                new Date('Wed, 01 Jan 2025 00:00:00 GMT').toISOString()
            );
        });

        it('should handle domain resolution error', async () => {
            domainResolver.resolve.mockResolvedValue('https://1tamilmv.cz');
            domainResolver.getUrl.mockImplementation(() => {
                throw new Error('Domain error');
            });

            await rssMonitor.checkRSSFeed('test_feed', 'feed_path.xml');

            expect(axios.get).not.toHaveBeenCalled();
        });

        it('should handle axios fetch error', async () => {
            domainResolver.resolve.mockResolvedValue('https://1tamilmv.cz');
            domainResolver.getUrl.mockReturnValue('https://1tamilmv.cz/feed.xml');
            axios.get.mockRejectedValue(new Error('Network error'));

            await rssMonitor.checkRSSFeed('test_feed', 'feed_path.xml');

            expect(notifier.notifyError).toHaveBeenCalledWith(
                expect.stringContaining('RSS Feed'),
                expect.stringContaining('Network error')
            );
        });

        it('should return 0 stats if no new items', async () => {
            domainResolver.resolve.mockResolvedValue('https://1tamilmv.cz');
            domainResolver.getUrl.mockReturnValue('https://1tamilmv.cz/feed.xml');
            axios.get.mockResolvedValue({
                data: '<rss><channel><item><pubDate>Wed, 01 Jan 2025 00:00:00 GMT</pubDate></item></channel></rss>',
            });

            fs.writeFileSync.mockImplementation(() => {});
            fs.renameSync.mockImplementation(() => {});
            fs.readFileSync.mockReturnValue(
                '<rss><channel><item><pubDate>Wed, 01 Jan 2025 00:00:00 GMT</pubDate></item></channel></rss>'
            );

            // Set last pub date to FUTURE of item
            rssMonitor.lastPubDates['test_feed'] = new Date('2025-02-01');

            const result = await rssMonitor.checkRSSFeed('test_feed', 'feed_path.xml');

            expect(result).toEqual({ items: 0, torrents: 0, moviesAdded: 0, moviesStarted: 0 });
            expect(orchestrator.processNew).not.toHaveBeenCalled();
        });
    });

    describe('startMonitoring - edge cases', () => {
        afterEach(() => {
            // Ensure FEEDS is always restored
            if (!config.FEEDS || Object.keys(config.FEEDS).length === 0) {
                config.FEEDS = { test_feed: 'feed_path.xml' };
            }
        });

        it('should return early if no feeds are configured', () => {
            const originalFeeds = config.FEEDS;
            config.FEEDS = {};

            // Should not throw, just return early
            rssMonitor.startMonitoring(false, 2);

            // Restore immediately
            config.FEEDS = originalFeeds;
        });

        it('should return early if FEEDS is null', () => {
            const originalFeeds = config.FEEDS;
            config.FEEDS = null;

            // Should not throw, just return early
            rssMonitor.startMonitoring(false, 2);

            // Restore immediately
            config.FEEDS = originalFeeds;
        });
    });

    describe('runChecks', () => {
        it('should run checks', async () => {
            // We need to mock qbittorrent require inside runChecks??
            // Jest mocks are hoisted, but require('./qbittorrent') inside function might be tricky if not strict.
            // We mocked "../../../src/services/qbittorrent" at top level.
            // rssMonitor.js does: const qbittorrent = require('./qbittorrent');
            // relative path from rssMonitor.js is './qbittorrent', which resolves to 'src/services/qbittorrent.js'.
            // Our mock is for '../../../src/services/qbittorrent', which resolves to same absolute path.
            // So it should work.

            // Mock checkRSSFeed (internal call)
            // mocking internal methods of the same instance/module is hard in CommonJS if not exported or using 'this'.
            // checkRSSFeed IS a method of the class.
            // But we are testing the instance exported by the module.
            // We can spyOn it.
            const checkSpy = jest.spyOn(rssMonitor, 'checkRSSFeed');
            checkSpy.mockResolvedValue({ items: 1, torrents: 0, moviesAdded: 0, moviesStarted: 0 });

            await rssMonitor.runChecks();

            expect(checkSpy).toHaveBeenCalled();
        });
    });
});
