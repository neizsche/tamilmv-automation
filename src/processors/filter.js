const config = require("../config");
const qbittorrent = require("../services/qbittorrent");
const { parseMovieName } = require("../utils/helpers");
const { log } = require("../utils/logger");

class TorrentFilter {
    async bySize(torrents) {
        const minBytes = config.TORRENT_SIZE.MIN_GB * 1024 ** 3;
        const maxBytes = config.TORRENT_SIZE.MAX_GB * 1024 ** 3;

        const removed = torrents.filter(
            torrent => torrent.size < minBytes || torrent.size > maxBytes
        );

        if (removed.length > 0) {
            log.info(`[FILTER] Removed ${removed.length} torrent(s) by size (outside ${config.TORRENT_SIZE.MIN_GB}-${config.TORRENT_SIZE.MAX_GB}GB)`);
            await qbittorrent.manageTorrents(removed, "delete", "inappropriate size");
        }

        const removedHashes = new Set(removed.map(t => t.hash));
        const filtered = torrents.filter(t => !removedHashes.has(t.hash));

        return { filtered, removed };
    }

    _findDuplicates(torrents) {
        const groupedTorrents = {};
        const torrentsToDelete = [];

        const filteredTorrents = torrents.filter(torrent =>
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

            movieTorrents.forEach((torrent) => {
                if (torrent.hash !== bestTorrent.hash) {
                    torrentsToDelete.push(torrent);
                }
            });
        });

        return torrentsToDelete;
    }

    async removeDuplicates(torrents) {
        const removed = this._findDuplicates(torrents);

        if (removed.length > 0) {
            log.info(`[FILTER] Removed ${removed.length} duplicate(s)`);
            await qbittorrent.manageTorrents(removed, "delete", "duplicate torrent");
        }

        const removedHashes = new Set(removed.map(t => t.hash));
        const filtered = torrents.filter(t => !removedHashes.has(t.hash));

        return { filtered, removed };
    }

    async filterTorrents(torrents) {
        let result = torrents;

        const sizeFilter = await this.bySize(result);
        result = sizeFilter.filtered;

        const dupFilter = await this.removeDuplicates(result);
        result = dupFilter.filtered;

        return result;
    }
}

module.exports = new TorrentFilter();
