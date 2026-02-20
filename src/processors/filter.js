const config = require('../config');
const qbittorrent = require('../services/qbittorrent');
const { parseMovieName } = require('../utils/helpers');
const { log } = require('../utils/logger');

class TorrentFilter {
    async bySize(torrents) {
        const minBytes = config.TORRENT_SIZE.MIN_GB * 1024 ** 3;
        const maxBytes = config.TORRENT_SIZE.MAX_GB * 1024 ** 3;

        const removedTooSmall = [];
        const removedTooLarge = [];
        const valid = [];

        for (const torrent of torrents) {
            const sizeGB = (torrent.size / 1024 ** 3).toFixed(2);
            if (torrent.size < minBytes) {
                log.debug(
                    `[FILTER] Size: ${torrent.name} (${sizeGB} GB) < Min (${config.TORRENT_SIZE.MIN_GB} GB) -> DROP (Too Small)`
                );
                removedTooSmall.push(torrent);
            } else if (torrent.size > maxBytes) {
                log.debug(
                    `[FILTER] Size: ${torrent.name} (${sizeGB} GB) > Max (${config.TORRENT_SIZE.MAX_GB} GB) -> DROP (Too Large)`
                );
                removedTooLarge.push(torrent);
            } else {
                log.debug(`[FILTER] Size: ${torrent.name} (${sizeGB} GB) -> KEEP`);
                valid.push(torrent);
            }
        }

        const allRemoved = [...removedTooSmall, ...removedTooLarge];

        if (allRemoved.length > 0) {
            await qbittorrent.manageTorrents(allRemoved, 'delete', 'inappropriate size');
        }

        return {
            filtered: valid,
            removed: allRemoved,
            countSmall: removedTooSmall.length,
            countLarge: removedTooLarge.length,
        };
    }

    _findDuplicates(torrents) {
        const groupedTorrents = {};
        const torrentsToDelete = [];

        const filteredTorrents = torrents.filter(
            (torrent) =>
                torrent.tags === config.QBITTORRENT.TAG &&
                torrent.category === config.QBITTORRENT.CATEGORY_ACTIVE
        );

        filteredTorrents.forEach((torrent) => {
            const movieTitle = torrent.name.split(/\(\d{4}\)/)[0].trim();
            if (!groupedTorrents[movieTitle]) {
                groupedTorrents[movieTitle] = [];
            }
            groupedTorrents[movieTitle].push(torrent);
        });

        Object.values(groupedTorrents).forEach((movieTorrents) => {
            if (movieTorrents.length <= 1) return;

            let bestTorrent = null;

            movieTorrents.forEach((torrent) => {
                if (torrent.progress > 0) {
                    if (!bestTorrent || torrent.progress > bestTorrent.progress) {
                        bestTorrent = torrent;
                    }
                } else if (!bestTorrent || torrent.size > bestTorrent.size) {
                    bestTorrent = torrent;
                }
            });

            log.debug(
                `[FILTER] Duplicate Group: ${movieTorrents[0].name.split(/\(\d{4}\)/)[0].trim()} (Count: ${movieTorrents.length})`
            );
            log.debug(
                `[FILTER]   - Keeping: ${bestTorrent.name} (${(bestTorrent.size / 1024 ** 3).toFixed(2)} GB)`
            );

            movieTorrents.forEach((torrent) => {
                if (torrent.hash !== bestTorrent.hash) {
                    log.debug(
                        `[FILTER]   - Removing: ${torrent.name} (${(torrent.size / 1024 ** 3).toFixed(2)} GB)`
                    );
                    torrentsToDelete.push(torrent);
                }
            });
        });

        return torrentsToDelete;
    }

    async removeDuplicates(torrents, allTorrents, originalBatchTorrents = null) {
        const removed = this._findDuplicates(torrents);

        const batchTorrentsToSkip = originalBatchTorrents || torrents;
        const currentBatchHashes = new Set(batchTorrentsToSkip.map((t) => t.hash));
        const existingMovies = new Set();

        allTorrents.forEach((torrent) => {
            // Skip if this torrent is part of the current batch we are processing
            if (currentBatchHashes.has(torrent.hash)) return;

            if (torrent.tags === config.QBITTORRENT.TAG) {
                const parsed = parseMovieName(torrent.name);
                existingMovies.add(parsed.display);
            }
        });

        const crossFeedDuplicates = torrents.filter((torrent) => {
            const parsed = parseMovieName(torrent.name);
            const isDuplicate = existingMovies.has(parsed.display);

            if (isDuplicate) {
                const removedHashes = new Set(removed.map((t) => t.hash));
                if (!removedHashes.has(torrent.hash)) {
                    removed.push(torrent);
                }
            }

            return isDuplicate;
        });

        if (removed.length > 0) {
            await qbittorrent.manageTorrents(removed, 'delete', 'duplicate torrent');
        }

        const removedHashes = new Set(removed.map((t) => t.hash));
        const filtered = torrents.filter((t) => !removedHashes.has(t.hash));

        return { filtered, removed };
    }

    async filterTorrents(torrents, allTorrents) {
        const initialCount = torrents.length;
        let result = torrents;

        const sizeFilter = await this.bySize(result);
        result = sizeFilter.filtered;

        const dupFilter = await this.removeDuplicates(result, allTorrents, torrents);
        result = dupFilter.filtered;

        const summary = {
            initial: initialCount,
            totalRemoved: sizeFilter.removed.length + dupFilter.removed.length,
            validSize: sizeFilter.filtered.length, // Intermediate count after size filter
            remaining: result.length,
            details: {
                tooSmall: sizeFilter.countSmall,
                tooLarge: sizeFilter.countLarge,
                duplicate: dupFilter.removed.length,
            },
        };

        return { remaining: result, summary };
    }
}

module.exports = new TorrentFilter();
