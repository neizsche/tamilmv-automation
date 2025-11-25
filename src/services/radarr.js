const axios = require("axios");
const config = require("../config");
const { log } = require("../utils/logger");
const { extractMovieName } = require("../utils/helpers");
const notifier = require("./notifier");

class RadarrClient {
  async addMovie(torrentName) {
    const movieName = extractMovieName(torrentName);
    
    try {
      // Lookup movie
      const lookupResponse = await axios.get(`${config.RADARR_URL}/api/v3/movie/lookup`, {
        params: { term: movieName },
        headers: { 'X-Api-Key': config.RADARR_API_KEY }
      });

      if (!lookupResponse.data?.length) {
        log.warning(`Movie not found: ${movieName}`);
        return;
      }

      const movieData = lookupResponse.data[0];
      
      // Check if movie already exists
      const existingResponse = await axios.get(`${config.RADARR_URL}/api/v3/movie`, {
        headers: { 'X-Api-Key': config.RADARR_API_KEY }
      });
      
      const existingMovie = existingResponse.data.find(m => m.tmdbId === movieData.tmdbId);
      if (existingMovie) {
        log.warning(`Movie already exists: ${movieData.title} (${movieData.year})`);
        return;
      }

      // Add movie
      const movieToAdd = {
        title: movieData.title,
        qualityProfileId: config.RADARR_QUALITY_PROFILE_ID,
        titleSlug: movieData.titleSlug,
        images: movieData.images,
        tmdbId: movieData.tmdbId,
        year: movieData.year,
        rootFolderPath: config.RADARR_ROOT_FOLDER,
        monitored: true,
        addOptions: { searchForMovie: false }
      };

      await axios.post(`${config.RADARR_URL}/api/v3/movie`, movieToAdd, {
        headers: {
          'X-Api-Key': config.RADARR_API_KEY,
          'Content-Type': 'application/json'
        }
      });

      log.success(`Added to Radarr: ${movieData.title} (${movieData.year})`);
      await notifier.notifyMovieAdded(movieData.title, movieData.year);
      
    } catch (error) {
      log.error(`Failed to add ${movieName}`, error.response?.data?.message || error.message);
    }
  }
}

module.exports = new RadarrClient();