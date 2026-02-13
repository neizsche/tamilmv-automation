const path = require("path");
const config = require("../config");
const qbittorrent = require("../services/qbittorrent");
const csvLogger = require("../utils/csvLogger");
const { wait } = require("../utils/helpers");
const { log } = require("../utils/logger");

const downloader = require("./downloader");
const scraper = require("./scraper");
const filter = require("./filter");
const radarr = require("./radarr");

class TorrentOrchestrator {
    async processSingle(torrentLink) {
        const fileName = downloader.generateFilename();
        const filePath = path.resolve(config.TORRENT_FOLDER, fileName);

        try {
            const downloadSuccess = await downloader.download(torrentLink, fileName);
            if (!downloadSuccess) {
                downloader.delete(fileName);
                return false;
            }

            const uploadSuccess = await qbittorrent.addTorrent(filePath);
            downloader.delete(fileName);

            return uploadSuccess;
        } catch (error) {
            log.error(`Error processing torrent link: ${torrentLink}`, error);
            downloader.delete(fileName);
            return false;
        }
    }

    _logToCSV(torrents) {
        for (const torrent of torrents) {
            csvLogger.logAdded(torrent.name, torrent.size);
        }
    }

    async _verifyStoppedTorrents() {
        await wait(2000);
        const stoppedTorrents = await qbittorrent.getTorrents(true);
        if (stoppedTorrents.length > 0) {
            log.warning(`[MAINTENANCE] Found ${stoppedTorrents.length} stopped torrent(s). Attempting to start them...`);
            for (const t of stoppedTorrents) {
                log.warning(`   - ${t.name}`);
            }
            await qbittorrent.manageTorrents(stoppedTorrents, "start");
        }
    }

    async cleanUnwanted() {
        try {
            let torrents = await qbittorrent.getTorrents(true);

            torrents = await filter.filterTorrents(torrents);

            const { toDelete, toStart, movieProcessing } = await radarr.categorize(torrents);

            await radarr.addMovies(toStart, movieProcessing);

            if (toDelete.length > 0) {
                await qbittorrent.manageTorrents(toDelete, "delete", "movie file already available");
            }

            if (toStart.length > 0) {
                this._logToCSV(toStart);
                await qbittorrent.manageTorrents(toStart, "start");
            }

            await this._verifyStoppedTorrents();
            radarr.logResults(movieProcessing);

        } catch (error) {
            log.error("Error cleaning unwanted torrents", error);
        }
    }

    async processNew(items) {
        try {
            log.info(`Processing ${items.length} new items`);

            const flatLinks = await scraper.scrapeAll(items, 200);

            log.info(`[DOWNLOAD] Processing ${flatLinks.length} torrent file(s) in batches of 10`);

            const BATCH_SIZE = 10;
            for (let i = 0; i < flatLinks.length; i += BATCH_SIZE) {
                const batch = flatLinks.slice(i, i + BATCH_SIZE);
                await Promise.allSettled(batch.map(link => this.processSingle(link)));
            }

            await this.cleanUnwanted();

            downloader.cleanupOrphaned();
        } catch (error) {
            log.error("Error processing new items", error);
        }
    }
}

module.exports = new TorrentOrchestrator();
