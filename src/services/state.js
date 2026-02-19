class StateService {
    constructor() {
        this.movies = new Map(); // Key: normalized title (lowercase), Value: Movie object
        this.tmdbIndex = new Map(); // Key: tmdbId (number), Value: Movie object
        this.torrents = new Map(); // Key: hash, Value: Torrent object
        this.addedTorrents = new Map(); // Key: hash, Value: { hash, name, size, category } — current run only
    }

    // Movies
    setMovies(movies) {
        this.movies.clear();
        this.tmdbIndex.clear();
        for (const movie of movies) {
            this._addMovieToCache(movie);
        }
        // log.info(`[STATE] Cache updated with ${this.movies.size} movies`);
    }

    _addMovieToCache(movie) {
        // We cache strictly by title for now as that's our primary lookup key from RSS
        // Radarr movies have 'title' and 'year'
        if (movie.title) {
            const key = movie.title.toLowerCase().trim();
            this.movies.set(key, movie);
        }
        if (movie.tmdbId) {
            this.tmdbIndex.set(movie.tmdbId, movie);
        }
    }

    addMovie(movie) {
        this._addMovieToCache(movie);
        // log.debug(`[STATE] Added movie to cache: ${movie.title}`);
    }

    getMovie(title) {
        if (!title) return null;
        const key = title.toLowerCase().trim();
        return this.movies.get(key) || null;
    }

    getMovieByTmdbId(tmdbId) {
        if (!tmdbId) return null;
        return this.tmdbIndex.get(tmdbId) || null;
    }

    // Torrents
    setTorrents(torrents) {
        this.torrents.clear();
        for (const torrent of torrents) {
            this.torrents.set(torrent.hash, torrent);
        }
        // log.info(`[STATE] Cache updated with ${this.torrents.size} torrents`);
    }

    addTorrent(torrent) {
        if (torrent && torrent.hash) {
            this.torrents.set(torrent.hash, torrent);
        }
    }

    removeTorrent(hash) {
        this.torrents.delete(hash);
    }

    getTorrent(hash) {
        return this.torrents.get(hash) || null;
    }

    // Added Torrents (current run registry)
    registerAddedTorrent({ hash, name, size, category }) {
        if (hash) {
            this.addedTorrents.set(hash, { hash, name, size, category });
        }
    }

    getAddedTorrents() {
        return Array.from(this.addedTorrents.values());
    }

    clearAddedTorrents() {
        this.addedTorrents.clear();
    }
}

module.exports = new StateService();
