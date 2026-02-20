const { radarrClient, retryWithBackoff } = require('../utils/httpClient');
const config = require('../config');
const { log } = require('../utils/logger');
const { extractMovieName, parseMovieName } = require('../utils/helpers');
const notifier = require('./notifier');
const state = require('./state');

class RadarrManager {
    async getMovies() {
        try {
            const response = await radarrClient.get('/api/v3/movie', {
                timeout: 30000,
            });
            return response.data;
        } catch (error) {
            log.error('Failed to fetch movies from Radarr', error.message);
            return [];
        }
    }

    async addMovie(torrentName) {
        const movieName = extractMovieName(torrentName);

        try {
            // Wrap in retry logic to handle temporary Radarr downtime
            return await retryWithBackoff(
                async () => {
                    const lookupResponse = await radarrClient.get(
                        `/api/v3/movie/lookup`,
                        { params: { term: movieName } }
                    );

                    if (!lookupResponse.data?.length) {
                        // Fallback: Try without year
                        const cleanName = movieName.replace(/\s*\(\d{4}\)$/, '');
                        if (cleanName !== movieName) {
                            log.debug(
                                `Movie not found: '${movieName}'. Retrying with '${cleanName}'...`
                            );
                            const retryResponse = await radarrClient.get(
                                `/api/v3/movie/lookup`,
                                { params: { term: cleanName } }
                            );

                            if (retryResponse.data?.length) {
                                lookupResponse.data = retryResponse.data;
                            } else {
                                log.warning(
                                    `Movie not found: ${movieName} (also failed with ${cleanName})`
                                );
                                return;
                            }
                        } else {
                            log.warning(`Movie not found: ${movieName}`);
                            return;
                        }
                    }

                    const movieData = lookupResponse.data[0];

                    // Check if movie is already in library (Radarr returns 'added' property in lookup)
                    if (movieData.added && movieData.added !== '0001-01-01T00:00:00Z') {
                        log.warning(
                            `Movie already exists in Radarr: ${movieData.title} (${movieData.year})`
                        );
                        // Update cache just in case
                        state.addMovie(movieData);
                        return { added: false, exists: true };
                    }

                    // Optimize: Check cache first
                    const existingInCache = state.getMovie(movieData.title);
                    if (existingInCache) {
                        log.warning(
                            `Movie already exists (cache): ${movieData.title} (${movieData.year})`
                        );
                        return { added: false, exists: true };
                    }
                    // Double check by TMDB ID via API if lookup property is unreliable
                    try {
                        const existingMovie = state.getMovieByTmdbId(movieData.tmdbId);

                        if (existingMovie) {
                            log.warning(
                                `Movie already exists (confirmed by ID): ${movieData.title} (${movieData.year})`
                            );
                            // Ensure cache is up to date (idempotent)
                            state.addMovie(existingMovie);
                            return { added: false, exists: true };
                        }
                    } catch {
                        // Ignore error here, proceed to add
                    }

                    const movieToAdd = {
                        title: movieData.title,
                        qualityProfileId: config.RADARR_QUALITY_PROFILE_ID,
                        titleSlug: movieData.titleSlug,
                        images: movieData.images,
                        tmdbId: movieData.tmdbId,
                        year: movieData.year,
                        rootFolderPath: config.RADARR_ROOT_FOLDER,
                        monitored: false,
                        addOptions: { searchForMovie: false },
                    };

                    try {
                        const addedMovieResponse = await radarrClient.post(
                            `/api/v3/movie`,
                            movieToAdd
                        );

                        // Add to cache
                        if (addedMovieResponse.data) {
                            state.addMovie(addedMovieResponse.data);
                        }
                    } catch (addError) {
                        // Handle specific case where movie might have been added concurrently or lookup was stale
                        if (
                            addError.response &&
                            addError.response.data &&
                            JSON.stringify(addError.response.data).includes('already exists')
                        ) {
                            log.warning(
                                `Movie already exists (caught during add): ${movieData.title}`
                            );
                            return { added: false, exists: true };
                        }
                        throw addError; // Re-throw other errors
                    }

                    // Send notification
                    const notificationSent = await notifier.notifyMovieAdded(
                        movieData.title,
                        movieData.year
                    );

                    // Return movie details for consolidated logging
                    return {
                        added: true,
                        title: movieData.title,
                        year: movieData.year,
                        notified: notificationSent,
                    };
                },
                3,
                2000,
                `Adding movie ${movieName} to Radarr`
            );
        } catch (error) {
            log.error(
                `Failed to add ${movieName} after retries`,
                error.response?.data?.message || error.message
            );
            return { added: false };
        }
    }

    async checkMovieStatus(torrentName) {
        const movieName = extractMovieName(torrentName);

        // 1. Check Cache
        const cachedMovie = state.getMovie(movieName);
        if (cachedMovie) {
            const hasFile = cachedMovie.hasFile;
            log.debug(`[CACHE_HIT] ${movieName} found in state. HasFile: ${hasFile}`);
            return {
                exists: true,
                hasFile: hasFile,
                title: cachedMovie.title,
                year: cachedMovie.year,
            };
        }

        try {
            return await retryWithBackoff(
                async () => {
                    const lookupResponse = await radarrClient.get(
                        `/api/v3/movie/lookup`,
                        { params: { term: movieName } }
                    );

                    if (!lookupResponse.data?.length) {
                        // Fallback: Try without year
                        const cleanName = movieName.replace(/\s*\(\d{4}\)$/, '');
                        if (cleanName !== movieName) {
                            log.debug(
                                `[RADARR_API] Lookup for '${movieName}' failed. Retrying with '${cleanName}'...`
                            );
                            const retryResponse = await radarrClient.get(
                                `/api/v3/movie/lookup`,
                                { params: { term: cleanName } }
                            );

                            if (retryResponse.data?.length) {
                                lookupResponse.data = retryResponse.data;
                            } else {
                                log.debug(
                                    `[RADARR_API] Lookup for '${cleanName}' returned 0 results.`
                                );
                                return { exists: false, hasFile: false };
                            }
                        } else {
                            log.debug(`[RADARR_API] Lookup for '${movieName}' returned 0 results.`);
                            return { exists: false, hasFile: false };
                        }
                    }

                    const movieData = lookupResponse.data[0];
                    log.debug(
                        `[RADARR_API] Lookup for '${movieName}' found: ${movieData.title} (Year: ${movieData.year}, TMDB: ${movieData.tmdbId})`
                    );

                    // Double check by TMDB ID via index (O(1)) instead of full API fetch (O(N))
                    const existingMovie = state.getMovieByTmdbId(movieData.tmdbId);

                    if (!existingMovie) {
                        log.debug(
                            `[RADARR_API] '${movieData.title}' not found in library (via TMDB ID check).`
                        );
                        return { exists: false, hasFile: false };
                    }

                    // Movie found in cache (via TMDB ID)
                    log.debug(
                        `[RADARR_API] '${existingMovie.title}' found in library. HasFile: ${existingMovie.hasFile}, Monitored: ${existingMovie.monitored}`
                    );

                    return {
                        exists: true,
                        hasFile: existingMovie.hasFile,
                        title: existingMovie.title,
                        year: existingMovie.year,
                    };
                },
                3,
                1000,
                `Checking movie status: ${movieName}`
            );
        } catch (error) {
            log.warning(`Failed to check movie status: ${movieName}`, error.message);
            return { exists: false, hasFile: false };
        }
    }

    async _checkStatusProcessor(torrent) {
        const movieStatus = await this.checkMovieStatus(torrent.name);
        const parsed = parseMovieName(torrent.name);
        const sizeGB = (torrent.size / 1024 ** 3).toFixed(2);

        return { torrent, movieStatus, parsed, sizeGB };
    }

    async categorize(torrents) {
        const toStart = [];
        const toDelete = [];
        const movieProcessing = new Map();

        const statusChecks = await Promise.allSettled(
            torrents.map((torrent) => this._checkStatusProcessor(torrent))
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
                const result = await this.addMovie(torrent.name);
                if (result && result.added) {
                    status.notified = result.notified || false;
                } else if (result && result.exists) {
                    const movieStatus = await this.checkMovieStatus(torrent.name);
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

        await Promise.allSettled(
            moviesToCheck.map(async (entry) => {
                try {
                    const status = await this.checkMovieStatus(entry.parsed.display);
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

module.exports = new RadarrManager();
