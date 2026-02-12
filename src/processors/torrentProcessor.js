const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const config = require("../config");
const qbittorrent = require("../services/qbittorrent");
const radarr = require("../services/radarr");
const { wait, ensureFolderExists, parseMovieName } = require("../utils/helpers");
const { log, displayProgressBar } = require("../utils/logger");
const notifier = require("../services/notifier");

class TorrentProcessor {
  constructor() {
    ensureFolderExists(config.TORRENT_FOLDER);
  }

  async downloadFile(torrentLink, fileName) {
    const filePath = path.resolve(config.TORRENT_FOLDER, fileName);

    try {
      const writer = fs.createWriteStream(filePath);
      const response = await axios.get(torrentLink, {
        responseType: "stream",
        timeout: 30000 // 30 second timeout
      });
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on("finish", () => {
          // Verify file was actually created and has content
          if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
            resolve(true);
          } else {
            log.warning(`Downloaded file is empty or missing: ${fileName}`);
            resolve(false);
          }
        });
        writer.on("error", (err) => {
          log.warning(`Stream error downloading ${fileName}: ${err.message}`);
          // Clean up partial file
          try { fs.unlinkSync(filePath); } catch (e) { }
          resolve(false);
        });
      });
    } catch (error) {
      log.warning(`Error downloading file from ${torrentLink}: ${error.message}`);
      // Clean up any partial file
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (e) { }
      return false;
    }
  }

  deleteTorrentFile(fileName) {
    const filePath = path.resolve(config.TORRENT_FOLDER, fileName);

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
      return false;
    } catch (error) {
      log.warning(`Error deleting file: ${filePath}`, error.message);
      return false;
    }
  }

  async scrapeTorrentLinks(pageUrl) {
    try {
      const { data } = await axios.get(pageUrl);
      const $ = cheerio.load(data);
      const torrentLinks = [];

      $("a").each((index, element) => {
        const href = $(element).attr("href");
        if (href && href.includes("applications/core/interface/file/attachment.php")) {
          torrentLinks.push(href.split('"')[0].trim());
        }
      });

      return torrentLinks;
    } catch (error) {
      return [];
    }
  }

  async scrapeWithRetries(url, maxRetries = config.SCRAPING.MAX_RETRIES, delayMs = config.SCRAPING.DELAY_MS) {
    let attempts = 0;
    let links = [];

    while (attempts < maxRetries) {
      links = await this.scrapeTorrentLinks(url);
      if (links.length > 0) break;

      attempts++;
      if (attempts < maxRetries) await wait(delayMs);
    }

    if (links.length === 0) {
      log.warning(`Failed to scrape any links from ${url} after ${maxRetries} attempts.`);
    }

    return links;
  }

  identifyTorrentsToDelete(torrents) {
    const groupedTorrents = {};
    const torrentsToDelete = [];

    const filteredTorrents = torrents.filter(torrent =>
      torrent.tags === config.QBITTORRENT.TAG && torrent.category === config.QBITTORRENT.CATEGORY_ACTIVE
    );

    filteredTorrents.forEach((torrent) => {
      const movieTitle = torrent.name.split(/\(\d{4}\)/)[0].trim();
      if (!groupedTorrents[movieTitle]) {
        groupedTorrents[movieTitle] = [];
      }
      groupedTorrents[movieTitle].push(torrent);
    });

    Object.values(groupedTorrents).forEach((movieTorrents) => {
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

  /**
   * Filter torrents by size range
   * @private
   * @param {Array} torrents - Array of torrent objects
   * @returns {Object} { filtered: Array, removed: Array }
   */
  async _filterBySize(torrents) {
    const removed = torrents.filter(
      torrent => torrent.size < config.TORRENT_SIZE.MIN_GB * 1024 ** 3 ||
        torrent.size > config.TORRENT_SIZE.MAX_GB * 1024 ** 3
    );

    if (removed.length > 0) {
      log.info(`[FILTER] Removed ${removed.length} torrent(s) by size (outside ${config.TORRENT_SIZE.MIN_GB}-${config.TORRENT_SIZE.MAX_GB}GB)`);
      await qbittorrent.manageTorrents(removed, "delete", "inappropriate size");
    }

    const removedHashes = new Set(removed.map(t => t.hash));
    const filtered = torrents.filter(t => !removedHashes.has(t.hash));

    return { filtered, removed };
  }

  /**
   * Filter duplicate torrents, keeping the best one per movie
   * @private
   * @param {Array} torrents - Array of torrent objects
   * @returns {Object} { filtered: Array, removed: Array }
   */
  async _filterDuplicates(torrents) {
    const removed = this.identifyTorrentsToDelete(torrents);

    if (removed.length > 0) {
      log.info(`[FILTER] Removed ${removed.length} duplicate(s)`);
      await qbittorrent.manageTorrents(removed, "delete", "duplicate torrent");
    }

    const removedHashes = new Set(removed.map(t => t.hash));
    const filtered = torrents.filter(t => !removedHashes.has(t.hash));

    return { filtered, removed };
  }

  /**
   * Categorize torrents by Radarr status
   * @private
   * @param {Array} torrents - Array of torrent objects
   * @returns {Object} { toDelete: Array, toStart: Array, movieProcessing: Map }
   */
  async _categorizeByRadarrStatus(torrents) {
    const toStart = [];
    const toDelete = [];
    const movieProcessing = new Map();

    // Parallelize Radarr status checks
    const radarrChecks = await Promise.allSettled(
      torrents.map(async (torrent) => {
        const movieStatus = await radarr.checkMovieStatus(torrent.name);
        const parsed = parseMovieName(torrent.name);
        const sizeGB = (torrent.size / 1024 ** 3).toFixed(2);

        return { torrent, movieStatus, parsed, sizeGB };
      })
    );

    // Process results
    for (const result of radarrChecks) {
      if (result.status === 'fulfilled') {
        const { torrent, movieStatus, parsed, sizeGB } = result.value;

        if (movieStatus.exists && movieStatus.hasFile) {
          // Movie already in Radarr AND has file → delete torrent
          toDelete.push(torrent);
        } else if (movieStatus.exists && !movieStatus.hasFile) {
          // Movie in Radarr but NO file → download it (don't re-add to Radarr)
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
          // Movie NOT in Radarr → add to Radarr and download
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
        // Handle rejected promises - still start the torrent
        log.error(`Error checking Radarr status:`, result.reason?.message || result.reason);
      }
    }

    return { toDelete, toStart, movieProcessing };
  }

  /**
   * Extract movies that need to be added to Radarr
   * @private
   * @param {Array} torrentsToStart - Torrents that will be started
   * @param {Map} movieProcessing - Map of movie processing status
   * @returns {Array} Movies to add with their associated data
   */
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

  /**
   * Add movies to Radarr in parallel
   * @private
   * @param {Array} moviesToAdd - Movies to add with their metadata
   * @param {Map} movieProcessing - Map to update with results
   */
  async _addMoviesToRadarr(moviesToAdd, movieProcessing) {
    const addMoviePromises = moviesToAdd.map(async ({ movieName, status, torrent }) => {
      try {
        const result = await radarr.addMovie(torrent.name);
        if (result && result.added) {
          status.notified = result.notified || false;
        } else {
          status.addedToRadarr = false;
          log.warning(`Failed to add ${movieName} to Radarr`);
        }
      } catch (error) {
        status.addedToRadarr = false;
        log.error(`Error adding ${movieName} to Radarr:`, error.message);
      }
    });

    await Promise.allSettled(addMoviePromises);
  }

  /**
   * Batch log torrents to CSV
   * @private
   * @param {Array} torrents - Torrents to log
   */
  _batchLogTorrentsToCSV(torrents) {
    const csvLogger = require("../utils/csvLogger");
    for (const torrent of torrents) {
      csvLogger.logAdded(torrent.name, torrent.size);
    }
  }

  /**
   * Verify and restart any stopped torrents
   * @private
   */
  async _verifyStoppedTorrents() {
    await wait(2000);
    const stoppedTorrents = await qbittorrent.getTorrents(true);
    if (stoppedTorrents.length > 0) {
      log.warning(`[MAINTENANCE] Found ${stoppedTorrents.length} stopped torrent(s). Attempting to start them...`);
      for (const t of stoppedTorrents) {
        log.warning(`   - ${t.name}`);
      }
      await qbittorrent.manageTorrents(stoppedTorrents, "start");
    }
  }

  /**
   * Log consolidated processing results
   * @private
   * @param {Map} movieProcessing - Map of movie processing status
   */
  _logProcessingResults(movieProcessing) {
    if (movieProcessing.size > 0) {
      log.info(`\n${movieProcessing.size} movie(s):`);
      for (const [movieName, status] of movieProcessing) {
        const statusParts = [
          status.addedToRadarr ? '[ADDED]' : '',
          status.notified ? '[NOTIFIED]' : '',
          status.downloading ? '[DOWNLOADING]' : ''
        ].filter(e => e).join(' ');

        const yearStr = status.year ? ` (${status.year})` : '';
        log.success(`${statusParts} ${status.name}${yearStr} - ${status.size} GB`);
      }
    } else {
      log.info('[PROCESSING] No new movies to process');
    }
  }

  async cleanUnwantedTorrents() {
    try {
      // Fetch all torrents once
      let torrents = await qbittorrent.getTorrents(true);

      // Phase 1: Apply filters
      const sizeResult = await this._filterBySize(torrents);
      torrents = sizeResult.filtered;

      const dupResult = await this._filterDuplicates(torrents);
      torrents = dupResult.filtered;

      // Phase 2: Categorize by Radarr status
      const { toDelete, toStart, movieProcessing } =
        await this._categorizeByRadarrStatus(torrents);

      // Phase 3: Add new movies to Radarr
      const moviesToAdd = this._extractMoviesToAdd(toStart, movieProcessing);
      await this._addMoviesToRadarr(moviesToAdd, movieProcessing);

      // Phase 4: Delete torrents for movies that already have files
      if (toDelete.length > 0) {
        await qbittorrent.manageTorrents(toDelete, "delete", "movie file already available");
      }

      // Phase 5: Log torrents to CSV and start them
      if (toStart.length > 0) {
        this._batchLogTorrentsToCSV(toStart);
        await qbittorrent.manageTorrents(toStart, "start");
      }

      // Phase 6: Verify and report
      await this._verifyStoppedTorrents();
      this._logProcessingResults(movieProcessing);

    } catch (error) {
      log.error("Error cleaning unwanted torrents", error);
    }
  }

  async processTorrentLink(torrentLink) {
    const uniqueSuffix = Math.random().toString(36).substring(2, 8);
    const fileName = `${Date.now()}-${uniqueSuffix}.torrent`;
    const filePath = path.resolve(config.TORRENT_FOLDER, fileName);

    try {
      const downloadSuccess = await this.downloadFile(torrentLink, fileName);
      if (!downloadSuccess) {
        // If download failed, make sure to clean up any partial file
        this.deleteTorrentFile(fileName);
        return false;
      }

      const uploadSuccess = await qbittorrent.addTorrent(filePath);

      // Always delete the temp file after upload attempt (success or failure)
      this.deleteTorrentFile(fileName);

      return uploadSuccess;
    } catch (error) {
      log.error(`Error processing torrent link: ${torrentLink}`, error);
      // Clean up temp file on error
      this.deleteTorrentFile(fileName);
    }
  }

  async processNewItems(items) {
    try {
      log.info(`Processing ${items.length} new items`);

      const links = [];
      for (const item of items) {
        try {
          const itemLinks = await this.scrapeTorrentLinks(item.link);
          if (itemLinks && itemLinks.length > 0) {
            links.push(...itemLinks);
          }

          await wait(200);

        } catch (error) {
          log.error(`Failed to scrape ${item.title}: ${error.message}`);
        }
      }

      const flatLinks = links.flat();
      log.info(`[DOWNLOAD] Processing ${flatLinks.length} torrent file(s) in batches of ${10}`);

      // Process in batches to limit memory usage and network connections
      const BATCH_SIZE = 10;
      for (let i = 0; i < flatLinks.length; i += BATCH_SIZE) {
        const batch = flatLinks.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(batch.map(link => this.processTorrentLink(link)));
      }

      await this.cleanUnwantedTorrents();

      // Clean up any leftover torrent files
      this.cleanupOldTorrentFiles();
    } catch (error) {
      log.error("Error processing new items", error);
    }
  }

  // Clean up orphaned torrent files
  cleanupOldTorrentFiles() {
    try {
      const files = fs.readdirSync(config.TORRENT_FOLDER);
      const torrentFiles = files.filter(f => f.endsWith('.torrent'));

      if (torrentFiles.length > 0) {
        log.info(`Cleaning up ${torrentFiles.length} orphaned torrent files`);
        torrentFiles.forEach(file => {
          this.deleteTorrentFile(file);
        });
      }
    } catch (error) {
      log.warning('Error cleaning up old torrent files', error.message);
    }
  }
}

module.exports = new TorrentProcessor();