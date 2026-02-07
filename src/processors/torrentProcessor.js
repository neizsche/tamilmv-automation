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

  async cleanUnwantedTorrents() {
    try {
      const filteredTorrents = await qbittorrent.getTorrents(true);

      // Delete by size
      const sizeTorrentsToDelete = filteredTorrents.filter(
        torrent => torrent.size < config.TORRENT_SIZE.MIN_GB * 1024 ** 3 || torrent.size > config.TORRENT_SIZE.MAX_GB * 1024 ** 3
      );

      if (sizeTorrentsToDelete.length > 0) {
        log.info(`[FILTER] Removed ${sizeTorrentsToDelete.length} torrent(s) by size (outside ${config.TORRENT_SIZE.MIN_GB}-${config.TORRENT_SIZE.MAX_GB}GB)`);
      }
      await qbittorrent.manageTorrents(sizeTorrentsToDelete, "delete", "inappropriate size");

      // Delete duplicates
      const updatedTorrents = await qbittorrent.getTorrents();
      const duplicateTorrentsToDelete = this.identifyTorrentsToDelete(updatedTorrents);

      if (duplicateTorrentsToDelete.length > 0) {
        log.info(`[FILTER] Removed ${duplicateTorrentsToDelete.length} duplicate(s)`);
      }
      await qbittorrent.manageTorrents(duplicateTorrentsToDelete, "delete", "duplicate torrent");

      // Check Radarr status for each torrent
      const finalTorrents = await qbittorrent.getTorrents(true);

      const torrentsToStart = [];
      const torrentsToDelete = [];
      const movieProcessing = new Map(); // Track movie processing status

      for (const torrent of finalTorrents) {
        try {
          const movieStatus = await radarr.checkMovieStatus(torrent.name);
          const parsed = parseMovieName(torrent.name);
          const sizeGB = (torrent.size / 1024 ** 3).toFixed(2);

          if (movieStatus.exists && movieStatus.hasFile) {
            // Movie already in Radarr AND has file → delete torrent
            torrentsToDelete.push(torrent);
          } else if (movieStatus.exists && !movieStatus.hasFile) {
            // Movie in Radarr but NO file → download it (don't re-add to Radarr)
            torrentsToStart.push(torrent);
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
            torrentsToStart.push(torrent);
            movieProcessing.set(parsed.display, {
              name: parsed.display,
              year: parsed.year,
              size: sizeGB,
              addedToRadarr: true,
              notified: false,
              downloading: true
            });
          }
        } catch (error) {
          log.error(`Error checking Radarr status for ${torrent.name}:`, error.message);
          // Still start the torrent even if Radarr check failed
          torrentsToStart.push(torrent);
        }
      }

      // Add new movies to Radarr and update processing status
      for (const [movieName, status] of movieProcessing) {
        if (status.addedToRadarr) {
          const torrent = torrentsToStart.find(t => {
            const parsed = parseMovieName(t.name);
            return parsed.display === movieName;
          });
          if (torrent) {
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
          }
        }
      }

      // Delete torrents for movies that already have files
      await qbittorrent.manageTorrents(torrentsToDelete, "delete", "movie file already available");

      // Start torrents (both new movies and monitored movies without files)
      await qbittorrent.manageTorrents(torrentsToStart, "start");

      // Verify if any torrents are still stopped (e.g. stalled or paused by qBit)
      // Wait a moment for start command to take effect
      await wait(2000);
      const stoppedTorrents = await qbittorrent.getTorrents(true);
      if (stoppedTorrents.length > 0) {
        log.warning(`[MAINTENANCE] Found ${stoppedTorrents.length} stopped torrent(s). Attempting to start them...`);
        for (const t of stoppedTorrents) {
          log.warning(`   - ${t.name}`);
        }
        await qbittorrent.manageTorrents(stoppedTorrents, "start");
      }

      // Output consolidated logs
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

      const links = await Promise.all(
        items.map(async (item) => {
          const links = await this.scrapeTorrentLinks(item.link);
          return links;
        })
      );

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