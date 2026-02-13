const radarr = require("../services/radarr");
const { parseMovieName } = require("../utils/helpers");
const { log } = require("../utils/logger");

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
            torrents.map(torrent => this._checkStatus(torrent))
        );

        for (const result of statusChecks) {
            if (result.status === 'fulfilled') {
                const { torrent, movieStatus, parsed, sizeGB } = result.value;

                if (movieStatus.exists && movieStatus.hasFile) {
                    log.debug(`[RADARR_DECISION] ${parsed.display}: Exists=TRUE, HasFile=TRUE -> DELETE`);
                    toDelete.push(torrent);
                } else if (movieStatus.exists && !movieStatus.hasFile) {
                    log.debug(`[RADARR_DECISION] ${parsed.display}: Exists=TRUE, HasFile=FALSE -> QUEUE (Download)`);
                    toStart.push(torrent);
                    movieProcessing.set(parsed.display, {
                        name: parsed.display,
                        year: parsed.year,
                        size: sizeGB,
                        addedToRadarr: false,
                        notified: false,
                        downloading: true
                    });
                } else {
                    log.debug(`[RADARR_DECISION] ${parsed.display}: Exists=FALSE -> QUEUE (Add & Download)`);
                    toStart.push(torrent);
                    movieProcessing.set(parsed.display, {
                        name: parsed.display,
                        year: parsed.year,
                        size: sizeGB,
                        addedToRadarr: true,
                        notified: false,
                        downloading: true
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
                const torrent = torrentsToStart.find(t => {
                    const parsed = parseMovieName(t.name);
                    return parsed.display === movieName;
                });
                return { movieName, status, torrent };
            })
            .filter(item => item.torrent);
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
                        log.info(`Movie exists in Radarr without file: ${movieName} - will download`);
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


}

module.exports = new RadarrIntegration();
