import { createWriteStream, existsSync, unlinkSync } from 'fs';
import { resolve as _resolve } from 'path';
import axios from 'axios';
import { load } from 'cheerio';
import { TORRENT_FOLDER, SCRAPING } from '../config/index.js';
import { getTorrents, manageTorrents, addTorrent } from '../services/qbittorrent.js';
import { checkMovieExists, addMovie } from '../services/radarr.js';
import { wait, ensureFolderExists } from '../utils/helpers.js';
import { log } from '../utils/logger.js';

class TorrentProcessor {
  constructor() {
    ensureFolderExists(TORRENT_FOLDER);
  }

  async downloadFile(torrentLink, fileName) {
    const filePath = _resolve(TORRENT_FOLDER, fileName);

    try {
      const writer = createWriteStream(filePath);
      const response = await get(torrentLink, { responseType: 'stream' });
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(true));
        writer.on('error', () => reject(false));
      });
    } catch (error) {
      log.warning(`Error downloading file from ${torrentLink}: ${error.message}`);
      return false;
    }
  }

  deleteTorrentFile(fileName) {
    const filePath = _resolve(TORRENT_FOLDER, fileName);

    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
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
      const { data } = await get(pageUrl);
      const $ = load(data);
      const torrentLinks = [];

      $('a').each((index, element) => {
        const href = $(element).attr('href');
        if (href && href.includes('applications/core/interface/file/attachment.php')) {
          torrentLinks.push(href.split('"')[0].trim());
        }
      });

      return torrentLinks;
    } catch {
      return [];
    }
  }

  async scrapeWithRetries(
    url,
    maxRetries = SCRAPING.MAX_RETRIES,
    delayMs = SCRAPING.DELAY_MS
  ) {
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

    const filteredTorrents = torrents.filter(
      (torrent) => torrent.tags === 'tamilmv' && torrent.category === 'radarr'
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
      const filteredTorrents = await getTorrents(true);

      // Delete by size
      const sizeTorrentsToDelete = filteredTorrents.filter(
        (torrent) => torrent.size < 1 * 1024 ** 3 || torrent.size > 3 * 1024 ** 3
      );
      await manageTorrents(sizeTorrentsToDelete, 'delete', 'inappropriate size');

      // Delete duplicates
      const updatedTorrents = await getTorrents();
      const duplicateTorrentsToDelete = this.identifyTorrentsToDelete(updatedTorrents);
      await manageTorrents(duplicateTorrentsToDelete, 'delete', 'duplicate torrent');

      // Check Radarr for existing available movies before starting
      const finalTorrents = await getTorrents(true);
      const torrentsToStart = [];
      const torrentsToDelete = [];

      for (const torrent of finalTorrents) {
        const movieExists = await checkMovieExists(torrent.name);
        if (movieExists) {
          torrentsToDelete.push(torrent);
        } else {
          torrentsToStart.push(torrent);
          await addMovie(torrent.name);
        }
      }

      // Delete torrents for movies that already exist in Radarr
      await manageTorrents(torrentsToDelete, 'delete', 'movie already in Radarr');

      // Start only the torrents for new movies
      await manageTorrents(torrentsToStart, 'start');
    } catch (error) {
      log.error('Error cleaning unwanted torrents', error);
    }
  }

  async processTorrentLink(torrentLink) {
    const fileName = `${Date.now()}.torrent`;

    const downloadSuccess = await this.downloadFile(torrentLink, fileName);
    if (!downloadSuccess) return false;

    const uploadSuccess = await addTorrent(
      _resolve(TORRENT_FOLDER, fileName)
    );

    this.deleteTorrentFile(fileName);
    return uploadSuccess;
  }

  async processNewItems(newItems) {
    // Parallel RSS scraping
    const scrapePromises = newItems.map((item) => this.scrapeWithRetries(item.link));
    const results = await Promise.allSettled(scrapePromises);
    const torrentLinks = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value)
      .flat();

    if (torrentLinks.length > 0) {
      const BATCH_SIZE = 50;
      const TOO_MANY_FOR_PARALLEL = 200;

      if (torrentLinks.length <= TOO_MANY_FOR_PARALLEL) {
        log.info(`Processing ${torrentLinks.length} torrents in parallel`);
        await Promise.allSettled(torrentLinks.map((link) => this.processTorrentLink(link)));
      } else {
        log.info(`Processing ${torrentLinks.length} torrents in batches`);
        for (let i = 0; i < torrentLinks.length; i += BATCH_SIZE) {
          const batch = torrentLinks.slice(i, i + BATCH_SIZE);
          await Promise.allSettled(batch.map((link) => this.processTorrentLink(link)));

          if (i + BATCH_SIZE < torrentLinks.length) {
            await wait(10);
          }
        }
      }
    }

    await this.cleanUnwantedTorrents();
  }
}

export default new TorrentProcessor();
