const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");
const fs = require("fs");
const path = require("path");
const config = require("../config");
const orchestrator = require("../processors/orchestrator");
const { log } = require("../utils/logger");
const notifier = require("./notifier");
const domainResolver = require("./domainResolver");
const { ensureFolderExists } = require("../utils/helpers");

class RSSMonitor {
  constructor() {
    this.parser = new XMLParser();
    this.lastPubDates = {};
    ensureFolderExists(config.FEED_FOLDER);
  }

  initializeLastPubDate(feedKey, ignoreFeed = false, days = 2) {
    const feedFile = path.join(config.FEED_FOLDER, `feed_${feedKey}.xml`);
    if (ignoreFeed) {
      const date = new Date();
      date.setDate(date.getDate() - days);
      log.info(`[${feedKey}] Ignoring ${feedFile} - initialized lastPubDate to ${days} day(s) ago: ${date}`);
      return date;
    }

    if (!fs.existsSync(feedFile)) {
      const date = new Date();
      date.setDate(date.getDate() - days);
      log.info(`[${feedKey}] Initialized lastPubDate to ${days} day(s) ago: ${date}`);
      return date;
    } else {
      try {
        const feedContent = fs.readFileSync(feedFile, "utf-8");
        const feed = this.parser.parse(feedContent);
        // Handle case where item might be undefined or empty
        const items = feed.rss && feed.rss.channel && feed.rss.channel.item
          ? (Array.isArray(feed.rss.channel.item) ? feed.rss.channel.item : [feed.rss.channel.item])
          : [];

        if (items.length > 0) {
          const date = new Date(items[0].pubDate);
          log.info(`[${feedKey}] Initialized lastPubDate to the date of the last item: ${date}`);
          return date;
        } else {
          throw new Error("No items in feed file");
        }
      } catch (error) {
        const date = new Date();
        date.setDate(date.getDate() - 30);
        log.warn(`[${feedKey}] Error reading ${feedFile} or empty, defaulting to 30 days ago: ${date}`);
        return date;
      }
    }
  }

  async checkRSSFeed(feedKey, feedPath) {
    // RESOLVE DOMAIN HERE
    const currentDomain = await domainResolver.resolve();

    let feedUrl;
    try {
      feedUrl = domainResolver.getUrl(feedPath);
    } catch (e) {
      log.error(`[${feedKey}] Error constructing URL for ${feedPath}: ${e.message}`);
      return;
    }

    log.info(`[${feedKey}] Checking RSS feed: ${feedUrl}`);

    try {
      const response = await axios.get(feedUrl, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      // REPLACE DOMAINS IN CONTENT
      // This ensures that all links in the feed point to the currently working domain
      let feedData = response.data.replace(/https:\/\/www\.1tamilmv\.[a-z]+/gi, currentDomain);

      // Use atomic write to prevent corruption if app crashes mid-write
      const feedFile = path.join(config.FEED_FOLDER, `feed_${feedKey}.xml`);
      const tempFile = `${feedFile}.tmp`;
      fs.writeFileSync(tempFile, feedData);
      fs.renameSync(tempFile, feedFile); // Atomic rename

      const feedContent = fs.readFileSync(feedFile, "utf-8");
      const feed = this.parser.parse(feedContent);
      const items = feed.rss && feed.rss.channel && feed.rss.channel.item
        ? (Array.isArray(feed.rss.channel.item) ? feed.rss.channel.item : [feed.rss.channel.item])
        : [];
      const newItems = [];

      for (const item of items) {
        const itemDate = new Date(item.pubDate);
        if (itemDate <= this.lastPubDates[feedKey]) break;
        newItems.push(item);
      }

      if (newItems.length === 0) {
        log.info(`[${feedKey}] No new items found.`);
      } else {
        log.info(`[${feedKey}] Found ${newItems.length} new items`);
        await orchestrator.processNew(newItems);
        this.lastPubDates[feedKey] = new Date(newItems[0].pubDate);
        log.info(`[${feedKey}] Updated lastPubDate to: ${this.lastPubDates[feedKey]}`);
      }

    } catch (error) {
      log.error(`[${feedKey}] Error fetching RSS feed from ${feedUrl}:`, error.message);
      await notifier.notifyError(`RSS Feed [${feedKey}]`, `Cannot access ${feedUrl} - ${error.message}`);
    }
  }

  async runChecks() {
    // Always cleanup completed torrents on every cycle
    log.info('[MAINTENANCE] Running cleanup...');
    const qbittorrent = require('./qbittorrent');
    await qbittorrent.cleanupCompletedTorrents();

    for (const [key, path] of Object.entries(config.FEEDS)) {
      await this.checkRSSFeed(key, path);
    }
  }

  startMonitoring(ignoreFeed = false, days = 2) {
    // Initialize lastPubDate for each feed
    if (!config.FEEDS || Object.keys(config.FEEDS).length === 0) {
      log.error("No FEEDS configured! Please check your config.");
      return;
    }

    for (const key of Object.keys(config.FEEDS)) {
      this.lastPubDates[key] = this.initializeLastPubDate(key, ignoreFeed, days);
    }

    const intervalMinutes = config.CHECK_INTERVAL / 60000;
    log.info('RSS Monitoring started');
    log.info(`Will check ${Object.keys(config.FEEDS).length} feeds every ${intervalMinutes} minutes`);

    for (const [key, path] of Object.entries(config.FEEDS)) {
      log.info(`Feed [${key}]: ${path}`);
    }
    log.info('');

    // Initial check
    this.runChecks();

    // Periodic checks with heartbeat
    setInterval(() => {
      log.info('Heartbeat - checking RSS feeds...');
      this.runChecks();
    }, config.CHECK_INTERVAL);
  }
}

module.exports = new RSSMonitor();