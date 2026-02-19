const radarr = require('../services/radarr');
const { parseMovieName } = require('../utils/helpers');
const { log } = require('../utils/logger');

class RadarrIntegration {
    async _checkStatus(torrent) {
        const movieStatus = await radarr.checkMovieStatus(torrent.name);
        const parsed = parseMovieName(torrent.name);
        const sizeGB = (torrent.size / 1024 ** 3).toFixed(2);

        return { torrent, movieStatus, parsed, sizeGB };
    }

    async categorize(torrents) {
        const toStart = [];
        const toDelete = [];
        const movieProcessing = new Map();

        const statusChecks = await Promise.allSettled(
            torrents.map((torrent) => this._checkStatus(torrent))
        );

        for (const result of statusChecks) {
            if (result.status === 'fulfilled') {
                const { torrent, movieStatus, parsed, sizeGB } = result.value;

                if (movieStatus.exists && movieStatus.hasFile) {
                    log.debug(
                        `[RADARR_DECISION] ${parsed.display}: Exists=TRUE, HasFile=TRUE -> DELETE`
                    );
                    toDelete.push(torrent);
                } else if (movieStatus.exists && !movieStatus.hasFile) {
                    log.debug(
                        `[RADARR_DECISION] ${parsed.display}: Exists=TRUE, HasFile=FALSE -> QUEUE (Download)`
                    );
                    toStart.push(torrent);
                    movieProcessing.set(parsed.display, {
                        name: parsed.display,
                        year: parsed.year,
                        size: sizeGB,
                        addedToRadarr: false,
                        notified: false,
                        downloading: true,
                    });
                } else {
                    log.debug(
                        `[RADARR_DECISION] ${parsed.display}: Exists=FALSE -> QUEUE (Add & Download)`
                    );
                    toStart.push(torrent);
                    movieProcessing.set(parsed.display, {
                        name: parsed.display,
                        year: parsed.year,
                        size: sizeGB,
                        addedToRadarr: true,
                        notified: false,
                        downloading: true,
                    });
                }
            } else {
                log.error(`Error checking Radarr status:`, result.reason?.message || result.reason);
            }
        }

        return { toDelete, toStart, movieProcessing };
    }

    _extractMoviesToAdd(torrentsToStart, movieProcessing) {
        return Array.from(movieProcessing.entries())
            .filter(([_, status]) => status.addedToRadarr)
            .map(([movieName, status]) => {
                const torrent = torrentsToStart.find((t) => {
                    const parsed = parseMovieName(t.name);
                    return parsed.display === movieName;
                });
                return { movieName, status, torrent };
            })
            .filter((item) => item.torrent);
    }

    async addMovies(torrentsToStart, movieProcessing) {
        const moviesToAdd = this._extractMoviesToAdd(torrentsToStart, movieProcessing);

        const addPromises = moviesToAdd.map(async ({ movieName, status, torrent }) => {
            try {
                const result = await radarr.addMovie(torrent.name);
                if (result && result.added) {
                    status.notified = result.notified || false;
                } else if (result && result.exists) {
                    const movieStatus = await radarr.checkMovieStatus(torrent.name);
                    if (movieStatus.hasFile) {
                        status.addedToRadarr = false;
                        status.downloading = false;
                        log.info(`Movie already has file in Radarr: ${movieName}`);
                    } else {
                        status.addedToRadarr = false;
                        log.info(
                            `Movie exists in Radarr without file: ${movieName} - will download`
                        );
                    }
                } else {
                    status.addedToRadarr = false;
                    log.warning(`Failed to add ${movieName} to Radarr`);
                }
            } catch (error) {
                status.addedToRadarr = false;
                log.error(`Error adding ${movieName} to Radarr:`, error.message);
            }
        });

        await Promise.allSettled(addPromises);
    }
    async filterItems(items) {
        // Group items by movie name to avoid redundant checks
        const movieMap = new Map();
        const itemsToProcess = [];

        // 1. Extract movie names and group items
        for (const item of items) {
            try {
                // Use title for parsing (RSS feed title: "Movie Name (Year) ...")
                const parsed = parseMovieName(item.title);
                if (!parsed.display) continue;

                if (!movieMap.has(parsed.display)) {
                    movieMap.set(parsed.display, {
                        parsed,
                        items: [],
                        status: null, // Will be populated later
                    });
                }
                movieMap.get(parsed.display).items.push(item);
            } catch (error) {
                log.warning(`Failed to parse movie name from RSS item: ${item.title}`);
                // If we can't parse it, safe to process it (let the scraper handle it)
                itemsToProcess.push(item);
            }
        }

        // 2. Check Radarr status for each unique movie
        const moviesToCheck = Array.from(movieMap.values());
        log.debug(`[RADARR_CHECK] Checking status for ${moviesToCheck.length} unique movie(s)...`);

        // Check sequentially or in small batches to be nice to Radarr API?
        // Parallel is fine for typical RSS feed size (10-20 items)
        await Promise.allSettled(
            moviesToCheck.map(async (entry) => {
                try {
                    const status = await radarr.checkMovieStatus(entry.parsed.display);
                    entry.status = status;
                } catch (error) {
                    log.error(
                        `Error checking Radarr status for ${entry.parsed.display}:`,
                        error.message
                    );
                    // If check fails, assume we need to process it
                    entry.status = { exists: false };
                }
            })
        );

        // 3. Filter items
        let skippedCount = 0;

        for (const entry of moviesToCheck) {
            const { parsed, status, items } = entry;

            if (status && status.exists && status.hasFile) {
                log.debug(
                    `[RADARR_SKIP] Skipping ${items.length} item(s) for "${parsed.display}" (Already has file in Radarr)`
                );
                skippedCount += items.length;
            } else {
                // Determine reason for processing
                let reason = 'New Movie';
                if (status && status.exists && !status.hasFile) {
                    reason = 'Exists but missing file';
                }

                log.debug(`[RADARR_PROCESS] "${parsed.display}" -> ${reason}`);
                itemsToProcess.push(...items);
            }
        }

        if (skippedCount > 0) {
            log.debug(`[RADARR_FILTER] Skipped total ${skippedCount} item(s) via early check.`);
        }

        return itemsToProcess;
    }
}

module.exports = new RadarrIntegration();
