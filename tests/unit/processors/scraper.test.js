const scraper = require('../../../src/processors/scraper');
const { createScraperClient } = require('../../../src/utils/httpClient');
const { log } = require('../../../src/utils/logger');
const { wait } = require('../../../src/utils/helpers');

// Mock dependencies
jest.mock('../../../src/utils/httpClient');
jest.mock('../../../src/utils/logger');
jest.mock('../../../src/utils/helpers', () => ({
    wait: jest.fn().mockResolvedValue(),
}));

describe('TorrentScraper', () => {
    let mockHttpClient;

    beforeEach(() => {
        jest.clearAllMocks();

        mockHttpClient = {
            get: jest.fn(),
        };
        createScraperClient.mockReturnValue(mockHttpClient);
        scraper.httpClient = mockHttpClient;
    });

    describe('scrapeLinks', () => {
        it('should scrape torrent links successfully', async () => {
            const html = `
                <html>
                    <body>
                        <a href="http://example.com/applications/core/interface/file/attachment.php?id=123">Link 1</a>
                        <a href="http://other.com">Link 2</a>
                        <a href="http://example.com/applications/core/interface/file/attachment.php?id=456">Link 3</a>
                    </body>
                </html>
            `;
            mockHttpClient.get.mockResolvedValue({ data: html });

            const links = await scraper.scrapeLinks('http://example.com/page');

            expect(links).toHaveLength(2);
            expect(links).toContain(
                'http://example.com/applications/core/interface/file/attachment.php?id=123'
            );
            expect(links).toContain(
                'http://example.com/applications/core/interface/file/attachment.php?id=456'
            );
            expect(mockHttpClient.get).toHaveBeenCalledWith('http://example.com/page');
        });

        it('should handle empty or no links', async () => {
            const html = '<html><body><p>No links</p></body></html>';
            mockHttpClient.get.mockResolvedValue({ data: html });

            const links = await scraper.scrapeLinks('http://example.com/page');

            expect(links).toHaveLength(0);
        });

        it('should handle http error gracefully', async () => {
            mockHttpClient.get.mockRejectedValue(new Error('Network error'));

            const links = await scraper.scrapeLinks('http://example.com/page');

            expect(links).toHaveLength(0);
            expect(log.warning).toHaveBeenCalledWith(expect.stringContaining('Failed to scrape'));
        });
    });

    describe('scrapeWithRetry', () => {
        it('should return links immediately if successful', async () => {
            const html =
                '<a href="http://example.com/applications/core/interface/file/attachment.php?id=1">Link</a>';
            mockHttpClient.get.mockResolvedValue({ data: html });

            const links = await scraper.scrapeWithRetry('http://example.com/page');

            expect(links).toHaveLength(1);
            expect(mockHttpClient.get).toHaveBeenCalledTimes(1);
        });

        it('should retry on failure to find links', async () => {
            // First attempt returns no links, second attempt returns links
            mockHttpClient.get
                .mockResolvedValueOnce({ data: '<html></html>' })
                .mockResolvedValueOnce({
                    data: '<a href="http://example.com/applications/core/interface/file/attachment.php?id=1">Link</a>',
                });

            const links = await scraper.scrapeWithRetry('http://example.com/page', 3, 100);

            expect(links).toHaveLength(1);
            expect(mockHttpClient.get).toHaveBeenCalledTimes(2);
            expect(wait).toHaveBeenCalledTimes(1);
        });

        it('should return empty after max retries', async () => {
            mockHttpClient.get.mockResolvedValue({ data: '<html></html>' });

            const links = await scraper.scrapeWithRetry('http://example.com/page', 2, 100);

            expect(links).toHaveLength(0);
            expect(mockHttpClient.get).toHaveBeenCalledTimes(2);
            expect(log.warning).toHaveBeenCalledWith(
                expect.stringContaining('Failed to scrape any links')
            );
        });
    });

    describe('scrapeAll', () => {
        it('should scrape multiple items', async () => {
            const items = [
                { link: 'http://example.com/page1', title: 'Item 1' },
                { link: 'http://example.com/page2', title: 'Item 2' },
            ];

            mockHttpClient.get.mockImplementation((url) => {
                if (url === 'http://example.com/page1') {
                    return Promise.resolve({
                        data: '<a href="http://example.com/applications/core/interface/file/attachment.php?id=1">Link 1</a>',
                    });
                }
                if (url === 'http://example.com/page2') {
                    return Promise.resolve({
                        data: '<a href="http://example.com/applications/core/interface/file/attachment.php?id=2">Link 2</a>',
                    });
                }
                return Promise.resolve({ data: '' });
            });

            const links = await scraper.scrapeAll(items, 10);

            expect(links).toHaveLength(2);
            expect(links).toContain(
                'http://example.com/applications/core/interface/file/attachment.php?id=1'
            );
            expect(links).toContain(
                'http://example.com/applications/core/interface/file/attachment.php?id=2'
            );
            expect(mockHttpClient.get).toHaveBeenCalledTimes(2);
        });

        it('should handle errors for individual items', async () => {
            const items = [
                { link: 'http://example.com/page1', title: 'Item 1' },
                { link: 'http://example.com/page2', title: 'Item 2' },
            ];

            mockHttpClient.get.mockImplementation((url) => {
                if (url === 'http://example.com/page1') {
                    return Promise.reject(new Error('Fail'));
                }
                return Promise.resolve({
                    data: '<a href="http://example.com/applications/core/interface/file/attachment.php?id=2">Link 2</a>',
                });
            });

            const links = await scraper.scrapeAll(items, 10);

            expect(links).toHaveLength(1);
            expect(log.warning).toHaveBeenCalled(); // Called inside scrapeLinks catch block
            // wait, scrapeAll doesn't catch httpClient errors if scrapeLinks handles them?
            // scrapeLinks catches error and returns [].
            // If scrapeAll calls scrapeLinks and wait(delayMs)
            // Wait, scrapeAll has its own try/catch block?
            // Yes: try { ... await this.scrapeLinks ... } catch (error) { log.error ... }
            // But scrapeLinks already catches errors and returns empty array.
            // So scrapeAll's catch block is unreachable unless wait throws or scrapeLinks throws (which it doesn't).
            // Let's verify scrapeLinks implementation.
            // scrapeLinks catches and returns []. So scrapeAll receives [] and continues.
            // Any exceptions inside the loop would be caught.
        });
    });
});
