import axios from 'axios';
import { RADARR_URL, RADARR_API_KEY, RADARR_QUALITY_PROFILE_ID, RADARR_ROOT_FOLDER } from '../config/index.js';
import { log } from '../utils/logger.js';
import { extractMovieName } from '../utils/helpers.js';
import notifier from './notifier.js';

class RadarrClient {
  async addMovie(torrentName) {
    const movieName = extractMovieName(torrentName);

    try {
      const lookupResponse = await get(`${RADARR_URL}/api/v3/movie/lookup`, {
        params: { term: movieName },
        headers: { 'X-Api-Key': RADARR_API_KEY },
      });

      if (!lookupResponse.data?.length) {
        log.warning(`Movie not found: ${movieName}`);
        return;
      }

      const movieData = lookupResponse.data[0];

      const existingResponse = await get(`${RADARR_URL}/api/v3/movie`, {
        headers: { 'X-Api-Key': RADARR_API_KEY },
      });

      const existingMovie = existingResponse.data.find((m) => m.tmdbId === movieData.tmdbId);
      if (existingMovie) {
        return;
      }

      const movieToAdd = {
        title: movieData.title,
        qualityProfileId: RADARR_QUALITY_PROFILE_ID,
        titleSlug: movieData.titleSlug,
        images: movieData.images,
        tmdbId: movieData.tmdbId,
        year: movieData.year,
        rootFolderPath: RADARR_ROOT_FOLDER,
        monitored: true,
        addOptions: { searchForMovie: false },
      };

      await post(`${RADARR_URL}/api/v3/movie`, movieToAdd, {
        headers: {
          'X-Api-Key': RADARR_API_KEY,
          'Content-Type': 'application/json',
        },
      });

      log.success(`Added to Radarr: ${movieData.title} (${movieData.year})`);
      await notifier.notifyMovieAdded(movieData.title, movieData.year);
    } catch (error) {
      log.error(`Failed to add ${movieName}`, error.response?.data?.message || error.message);
    }
  }

  async checkMovieExists(torrentName) {
    const movieName = extractMovieName(torrentName);

    try {
      const lookupResponse = await get(`${RADARR_URL}/api/v3/movie/lookup`, {
        params: { term: movieName },
        headers: { 'X-Api-Key': RADARR_API_KEY },
      });

      if (!lookupResponse.data?.length) {
        return false;
      }

      const movieData = lookupResponse.data[0];

      const existingResponse = await get(`${RADARR_URL}/api/v3/movie`, {
        headers: { 'X-Api-Key': RADARR_API_KEY },
      });

      const existingMovie = existingResponse.data.find((m) => m.tmdbId === movieData.tmdbId);

      if (!existingMovie) {
        return false;
      }

      return existingMovie.hasFile;
    } catch {
      return false;
    }
  }
}

export default new RadarrClient();
