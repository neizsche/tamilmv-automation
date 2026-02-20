class StateService {
    constructor() {
        // Core state arrays
        this.movies = []; // Array of { name: string, tmdbId: number }
        this.radarritems = []; // Array of full Radarr movie objects
        this.otorrents = []; // Array of qBittorrent torrent objects

        // Registry for torrents added in the current session
        this.addedTorrents = new Map(); // Key: hash, Value: { hash, name, size, category }
    }

    // Movies & Radarr Items
    setMovies(movies) {
        this.radarritems = movies || [];
        this.movies = (movies || []).map((m) => ({
            name: m.title,
            tmdbId: m.tmdbId,
        }));
    }

    addMovie(movie) {
        if (!movie) return;

        // Check if already in radarritems (by TMDB ID)
        const index = this.radarritems.findIndex((m) => m.tmdbId === movie.tmdbId);
        if (index === -1) {
            this.radarritems.push(movie);
            this.movies.push({ name: movie.title, tmdbId: movie.tmdbId });
        } else {
            // Update existing
            this.radarritems[index] = movie;
            const mIndex = this.movies.findIndex((m) => m.tmdbId === movie.tmdbId);
            if (mIndex !== -1) {
                this.movies[mIndex] = { name: movie.title, tmdbId: movie.tmdbId };
            }
        }
    }

    getMovie(title) {
        if (!title) return null;
        const searchTitle = title.toLowerCase().trim();
        // Return full object from radarritems as components expect 'hasFile', etc.
        return (
            this.radarritems.find((m) => m.title?.toLowerCase().trim() === searchTitle) || null
        );
    }

    getMovieByTmdbId(tmdbId) {
        if (!tmdbId) return null;
        return this.radarritems.find((m) => m.tmdbId === tmdbId) || null;
    }

    // qBittorrent Torrents
    setTorrents(torrents) {
        this.otorrents = torrents || [];
    }

    addTorrent(torrent) {
        if (torrent && torrent.hash) {
            const index = this.otorrents.findIndex((t) => t.hash === torrent.hash);
            if (index === -1) {
                this.otorrents.push(torrent);
            } else {
                this.otorrents[index] = torrent;
            }
        }
    }

    removeTorrent(hash) {
        this.otorrents = this.otorrents.filter((t) => t.hash !== hash);
    }

    getTorrent(hash) {
        return this.otorrents.find((t) => t.hash === hash) || null;
    }

    // Registry for current run tracking
    registerAddedTorrent({ hash, name, size, category }) {
        if (hash) {
            this.addedTorrents.set(hash, { hash, name, size, category });
        }
    }

    clearAddedTorrents() {
        this.addedTorrents.clear();
    }
}

module.exports = new StateService();
