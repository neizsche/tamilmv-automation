const axios = require("axios");
const config = require("../config");
const { log } = require("../utils/logger");
const { extractMovieName, retryWithBackoff } = require("../utils/helpers");
const notifier = require("./notifier");
const http = require('http');
const https = require('https');

// HTTP connection pooling for better performance
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

class RadarrClient {
  async addMovie(torrentName) {
    const movieName = extractMovieName(torrentName);

    try {
      // Wrap in retry logic to handle temporary Radarr downtime
      await retryWithBackoff(async () => {
        const lookupResponse = await axios.get(`${config.RADARR_URL}/api/v3/movie/lookup`, {
          params: { term: movieName },
          headers: { 'X-Api-Key': config.RADARR_API_KEY },
          timeout: 10000
        });

        if (!lookupResponse.data?.length) {
          log.warning(`Movie not found: ${movieName}`);
          return;
        }

        const movieData = lookupResponse.data[0];

        // Check if movie is already in library (Radarr returns 'added' property in lookup)
        if (movieData.added && movieData.added !== "0001-01-01T00:00:00Z") {
          log.warning(`Movie already exists in Radarr: ${movieData.title} (${movieData.year})`);
          return { added: false, exists: true };
        }

        // Double check by TMDB ID via API if lookup property is unreliable
        try {
          const existingMovie = await axios.get(`${config.RADARR_URL}/api/v3/movie`, {
            params: { tmdbId: movieData.tmdbId },
            headers: { 'X-Api-Key': config.RADARR_API_KEY },
            timeout: 10000
          });

          if (existingMovie.data && existingMovie.data.length > 0) {
            log.warning(`Movie already exists (confirmed by ID): ${movieData.title} (${movieData.year})`);
            return { added: false, exists: true };
          }
        } catch (err) {
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
          addOptions: { searchForMovie: false }
        };

        try {
          await axios.post(`${config.RADARR_URL}/api/v3/movie`, movieToAdd, {
            headers: {
              'X-Api-Key': config.RADARR_API_KEY,
              'Content-Type': 'application/json'
            },
            httpAgent,
            httpsAgent,
            timeout: 10000
          });
        } catch (addError) {
          // Handle specific case where movie might have been added concurrently or lookup was stale
          if (addError.response && addError.response.data &&
            JSON.stringify(addError.response.data).includes("already exists")) {
            log.warning(`Movie already exists (caught during add): ${movieData.title}`);
            return { added: false, exists: true };
          }
          throw addError; // Re-throw other errors
        }

        // Send notification
        const notificationSent = await notifier.notifyMovieAdded(movieData.title, movieData.year);

        // Return movie details for consolidated logging
        return {
          added: true,
          title: movieData.title,
          year: movieData.year,
          notified: notificationSent
        };
      }, 3, 2000, `Adding movie ${movieName} to Radarr`);

    } catch (error) {
      log.error(`Failed to add ${movieName} after retries`, error.response?.data?.message || error.message);
      return { added: false };
    }
  }

  async checkMovieStatus(torrentName) {
    const movieName = extractMovieName(torrentName);

    try {
      return await retryWithBackoff(async () => {
        const lookupResponse = await axios.get(`${config.RADARR_URL}/api/v3/movie/lookup`, {
          params: { term: movieName },
          headers: { 'X-Api-Key': config.RADARR_API_KEY },
          timeout: 10000
        });

        if (!lookupResponse.data?.length) {
          log.debug(`[RADARR_API] Lookup for '${movieName}' returned 0 results.`);
          return { exists: false, hasFile: false };
        }

        const movieData = lookupResponse.data[0];
        log.debug(`[RADARR_API] Lookup for '${movieName}' found: ${movieData.title} (Year: ${movieData.year}, TMDB: ${movieData.tmdbId})`);

        const existingResponse = await axios.get(`${config.RADARR_URL}/api/v3/movie`, {
          headers: { 'X-Api-Key': config.RADARR_API_KEY },
          timeout: 10000
        });

        const existingMovie = existingResponse.data.find(m => m.tmdbId === movieData.tmdbId);

        if (!existingMovie) {
          log.debug(`[RADARR_API] '${movieData.title}' not found in library (via GET /api/v3/movie).`);
          return { exists: false, hasFile: false };
        }

        log.debug(`[RADARR_API] '${existingMovie.title}' found in library. HasFile: ${existingMovie.hasFile}, Monitored: ${existingMovie.monitored}`);

        return {
          exists: true,
          hasFile: existingMovie.hasFile,
          title: existingMovie.title,
          year: existingMovie.year
        };
      }, 3, 1000, `Checking movie status: ${movieName}`);

    } catch (error) {
      log.warning(`Failed to check movie status: ${movieName}`, error.message);
      return { exists: false, hasFile: false };
    }
  }
}

module.exports = new RadarrClient();