const cheerio = require('cheerio');
const { defaultClient } = require('../utils/httpClient');
const { wait } = require('../utils/helpers');
const { log } = require('../utils/logger');

class TorrentScraper {
    constructor() { }

    async scrapeLinks(pageUrl) {
        try {
            const { data } = await defaultClient.get(pageUrl);
            const $ = cheerio.load(data);
            const torrentLinks = [];

            $('a').each((index, element) => {
                const href = $(element).attr('href');
                if (href && href.includes('applications/core/interface/file/attachment.php')) {
                    const link = href.split('"')[0].trim();
                    log.debug(`[SCRAPER] Found torrent link: ${link}`);
                    torrentLinks.push(link);
                }
            });

            log.debug(`[SCRAPER] Scraped ${torrentLinks.length} links from ${pageUrl}`);

            return torrentLinks;
        } catch (error) {
            log.warning(`Failed to scrape ${pageUrl}: ${error.message}`);
            return [];
        }
    }

    async scrapeAll(items, delayMs = 200) {
        const links = [];
        const BATCH_SIZE = 5;

        for (let i = 0; i < items.length; i += BATCH_SIZE) {
            const batch = items.slice(i, i + BATCH_SIZE);

            try {
                const batchResults = await Promise.all(
                    batch.map(async (item) => {
                        try {
                            const itemLinks = await this.scrapeLinks(item.link);
                            return itemLinks || [];
                        } catch (error) {
                            log.error(`Failed to scrape ${item.title}: ${error.message}`);
                            return [];
                        }
                    })
                );

                links.push(...batchResults.flat());
            } catch (error) {
                log.error(`Error in scraping batch: ${error.message}`);
            }

            if (i + BATCH_SIZE < items.length) {
                await wait(delayMs);
            }
        }

        return links;
    }
}

module.exports = new TorrentScraper();
