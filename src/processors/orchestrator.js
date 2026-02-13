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

    async _verifyStoppedTorrents(torrentHashes) {
        if (!torrentHashes || torrentHashes.length === 0) return;

        await wait(2000);
        const allStoppedTorrents = await qbittorrent.getTorrents(true);

        const stoppedTorrents = allStoppedTorrents.filter(t => torrentHashes.includes(t.hash));

        if (stoppedTorrents.length > 0) {
            log.warning(`[MAINTENANCE] Found ${stoppedTorrents.length} stopped torrent(s) that should be running. Attempting to start them...`);
            for (const t of stoppedTorrents) {
                log.warning(`   - ${t.name}`);
            }
            await qbittorrent.manageTorrents(stoppedTorrents, "start");
        }
    }

    async _cleanupLeftoverStoppedTorrents(activeHashes) {
        try {
            const allStoppedTorrents = await qbittorrent.getTorrents(true);
            if (allStoppedTorrents.length === 0) return;

            const leftovers = allStoppedTorrents.filter(t => !activeHashes.includes(t.hash));

            if (leftovers.length > 0) {
                log.warning(`[CLEANUP] Found ${leftovers.length} leftover stopped torrent(s). Removing...`);
                leftovers.forEach(t => log.debug(`[CLEANUP] Removing leftover: ${t.name}`));
                await qbittorrent.manageTorrents(leftovers, "delete", "leftover stopped torrent");
            }
        } catch (error) {
            log.error("Error cleaning leftover stopped torrents", error);
        }
    }

    async _cleanupOrphanedStoppedTorrents() {
        try {
            const allStoppedTorrents = await qbittorrent.getTorrents(true);
            if (allStoppedTorrents.length === 0) return;

            const torrentsToDelete = [];

            for (const torrent of allStoppedTorrents) {
                const movieStatus = await require("./radarr")._checkStatus(torrent);
                if (movieStatus.movieStatus.exists && movieStatus.movieStatus.hasFile) {
                    torrentsToDelete.push(torrent);
                }
            }

            if (torrentsToDelete.length > 0) {
                log.info(`[CLEANUP] Removing ${torrentsToDelete.length} orphaned stopped torrent(s) (movies have files in Radarr)`);
                await qbittorrent.manageTorrents(torrentsToDelete, "delete", "orphaned - movie file already available");
            }
        } catch (error) {
            log.error("Error cleaning orphaned stopped torrents", error);
        }
    }

    async cleanUnwanted() {
        const stats = {
            moviesAdded: 0,
            moviesStarted: 0,
            filterSummary: ''
        };

        try {
            let torrents = await qbittorrent.getTorrents(true);

            const filterResult = await filter.filterTorrents(torrents);
            torrents = filterResult.remaining;
            stats.filterSummary = filterResult.summary;

            const { toDelete, toStart, movieProcessing } = await radarr.categorize(torrents);

            await radarr.addMovies(toStart, movieProcessing);

            const torrentsToDelete = [...toDelete];
            const torrentsToStart = [];

            for (const torrent of toStart) {
                const parsed = require("../utils/helpers").parseMovieName(torrent.name);
                const movieStatus = movieProcessing.get(parsed.display);

                if (movieStatus && movieStatus.addedToRadarr === false && movieStatus.downloading === false) {
                    torrentsToDelete.push(torrent);
                    movieProcessing.delete(parsed.display);
                    log.info(`[FILTER] Moving to delete: ${parsed.display} (movie already in Radarr with file)`);
                } else {
                    torrentsToStart.push(torrent);
                }
            }

            if (torrentsToDelete.length > 0) {
                await qbittorrent.manageTorrents(torrentsToDelete, "delete", "movie file already available");
            }

            if (torrentsToStart.length > 0) {
                this._logToCSV(torrentsToStart);
                await qbittorrent.manageTorrents(torrentsToStart, "start");
                stats.moviesStarted = torrentsToStart.length;
            }

            // Collect details for logging locally or passing up
            const downloadingDetails = [];
            for (const [key, status] of movieProcessing.entries()) {
                if (status.downloading) {
                    downloadingDetails.push({ name: status.name, size: status.size });
                }
            }
            stats.downloadingDetails = downloadingDetails;

            stats.moviesAdded = movieProcessing.size;

            const hashesToVerify = torrentsToStart.map(t => t.hash);
            await this._verifyStoppedTorrents(hashesToVerify);

            // Stricter cleanup: Remove ANY stopped torrent with our tag that we didn't just start
            //await this._cleanupLeftoverStoppedTorrents(hashesToVerify);

            // Legacy cleanup (might be redundant now but checking Radarr status is safer? 
            // The new _cleanupLeftoverStoppedTorrents is more aggressive and better for "stopped" torrents that filter.js missed)
            // valid torrents are started, so they won't be stopped.
            // invalid torrents (too small/large/dup) are deleted by filter.js.
            // so any remaining stopped torrents are leftovers.

            await this._cleanupOrphanedStoppedTorrents();

        } catch (error) {
            log.error("Error cleaning unwanted torrents", error);
        }

        return stats;
    }

    async processNew(items, feedKey = 'unknown') {
        const stats = {
            items: items.length,
            torrents: 0,
            moviesAdded: 0,
            moviesStarted: 0,
            filterSummary: '',
            torrentsAdded: 0
        };

        try {
            log.info(`[${feedKey}] Scraping ${items.length} item(s)...`);
            const flatLinks = await scraper.scrapeAll(items, 200);
            stats.torrents = flatLinks.length;

            const BATCH_SIZE = 10;
            for (let i = 0; i < flatLinks.length; i += BATCH_SIZE) {
                const batch = flatLinks.slice(i, i + BATCH_SIZE);
                await Promise.allSettled(batch.map(link => this.processSingle(link)));
            }

            const addedTorrents = await qbittorrent.getTorrents(true);
            stats.torrentsAdded = addedTorrents.length;

            log.info(`[${feedKey}] Added ${stats.torrentsAdded}/${stats.torrents} to qBittorrent`);

            // Initial log - will be updated with details after cleaning
            log.info(`[${feedKey}] Filtering ${stats.torrentsAdded} torrent(s)...`);

            // Wait for qBittorrent to register the new torrents and set their state
            await wait(2000);

            const cleanupStats = await this.cleanUnwanted();
            stats.moviesAdded = cleanupStats.moviesAdded;
            stats.moviesStarted = cleanupStats.moviesStarted;
            stats.downloadingDetails = cleanupStats.downloadingDetails;

            // Format filter summary
            const s = cleanupStats.filterSummary; // This is now an object
            // stats.filterSummary needs to be a string for the table log below? 
            // The table log is inside checkRSSFeed in rssMonitor.js, NOT here.
            // Wait, orchestrator.processNew returns stats to rssMonitor.js.
            // rssMonitor.js logs the table.
            // So we just need to ensure stats.filterSummary is a formatted string or handle it in rssMonitor.
            // valuable to have a string representation here.

            const detailParts = [];
            if (s.details.tooSmall > 0) detailParts.push(`${s.details.tooSmall} too small`);
            if (s.details.tooLarge > 0) detailParts.push(`${s.details.tooLarge} too large`);
            if (s.details.duplicate > 0) detailParts.push(`${s.details.duplicate} duplicate`);

            const detailsStr = detailParts.length > 0 ? `(${detailParts.join(', ')})` : '';
            stats.filterSummary = `${s.initial} -> ${s.remaining} ${detailsStr}`;

            downloader.cleanupOrphaned();
        } catch (error) {
            log.error("Error processing new items", error);
        }

        return stats;
    }
}

module.exports = new TorrentOrchestrator();
