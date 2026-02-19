const cheerio = require('cheerio');
const { createScraperClient } = require('../utils/httpClient');
const { RetryConfig } = require('../utils/constants');
const { wait } = require('../utils/helpers');
const { log } = require('../utils/logger');

class TorrentScraper {
    constructor() {
        this.httpClient = createScraperClient();
    }

    async scrapeLinks(pageUrl) {
        try {
            const { data } = await this.httpClient.get(pageUrl);
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

    async scrapeWithRetry(
        url,
        maxRetries = RetryConfig.SCRAPING_MAX_RETRIES,
        delayMs = RetryConfig.SCRAPING_DELAY
    ) {
        let attempts = 0;
        let links = [];

        while (attempts < maxRetries) {
            links = await this.scrapeLinks(url);
            if (links.length > 0) break;

            attempts++;
            if (attempts < maxRetries) await wait(delayMs);
        }

        if (links.length === 0) {
            log.warning(`Failed to scrape any links from ${url} after ${maxRetries} attempts.`);
        }

        return links;
    }

    async scrapeAll(items, delayMs = 200) {
        const links = [];

        for (const item of items) {
            try {
                const itemLinks = await this.scrapeLinks(item.link);
                if (itemLinks && itemLinks.length > 0) {
                    links.push(...itemLinks);
                }

                await wait(delayMs);
            } catch (error) {
                log.error(`Failed to scrape ${item.title}: ${error.message}`);
            }
        }

        return links.flat();
    }
}

module.exports = new TorrentScraper();
