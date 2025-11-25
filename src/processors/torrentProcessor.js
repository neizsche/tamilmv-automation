const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const config = require("../config");
const qbittorrent = require("../services/qbittorrent");
const radarr = require("../services/radarr");
const { wait, ensureFolderExists } = require("../utils/helpers");
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
      const response = await axios.get(torrentLink, { responseType: "stream" });
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on("finish", () => resolve(true));
        writer.on("error", () => reject(false));
      });
    } catch (error) {
      log.warning(`Error downloading file from ${torrentLink}: ${error.message}`);
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
      torrent.tags === "tamilmv" && torrent.category === "radarr"
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
        torrent => torrent.size < 1 * 1024 ** 3 || torrent.size > 3 * 1024 ** 3
      );
      await qbittorrent.manageTorrents(sizeTorrentsToDelete, "delete", "inappropriate size");
      
      // Delete duplicates
      const updatedTorrents = await qbittorrent.getTorrents();
      const duplicateTorrentsToDelete = this.identifyTorrentsToDelete(updatedTorrents);
      await qbittorrent.manageTorrents(duplicateTorrentsToDelete, "delete", "duplicate torrent");
      
      // Start remaining torrents
      const finalTorrents = await qbittorrent.getTorrents(true);
      for (const torrent of finalTorrents) {
        await radarr.addMovie(torrent.name);
      }
      await qbittorrent.manageTorrents(finalTorrents, "start");
      
    } catch (error) {
      log.error("Error cleaning unwanted torrents", error);
    }
  }

  async processTorrentLink(torrentLink) {
    const fileName = `${Date.now()}.torrent`;

    const downloadSuccess = await this.downloadFile(torrentLink, fileName);
    if (!downloadSuccess) return false;

    const uploadSuccess = await qbittorrent.addTorrent(path.resolve(config.TORRENT_FOLDER, fileName));
    
    this.deleteTorrentFile(fileName);
    return uploadSuccess;
  }

  async processNewItems(newItems) {
    const torrentLinks = [];

    // Scrape all torrent links
    let total = newItems.length;
    for (let i = 0; i < total; i++) {
      const links = await this.scrapeWithRetries(newItems[i].link);
      torrentLinks.push(...links);
      displayProgressBar(i + 1, total, "Tamilmv movie links scraped");
    }

    // Process torrent links
    if (torrentLinks.length > 0) {
      total = torrentLinks.length;
      for (let i = 0; i < total; i++) {
        await wait(1000);
        await this.processTorrentLink(torrentLinks[i]);
        displayProgressBar(i + 1, total, "torrents added");
      }
    }

    await this.cleanUnwantedTorrents();
  }
}

module.exports = new TorrentProcessor();