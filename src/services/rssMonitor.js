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
      return date;
    }

    if (!fs.existsSync(feedFile)) {
      const date = new Date();
      date.setDate(date.getDate() - days);
      return date;
    } else {
      try {
        const feedContent = fs.readFileSync(feedFile, "utf-8");
        const feed = this.parser.parse(feedContent);
        const items = feed.rss && feed.rss.channel && feed.rss.channel.item
          ? (Array.isArray(feed.rss.channel.item) ? feed.rss.channel.item : [feed.rss.channel.item])
          : [];

        if (items.length > 0) {
          const date = new Date(items[0].pubDate);
          return date;
        } else {
          throw new Error("No items in feed file");
        }
      } catch (error) {
        const date = new Date();
        date.setDate(date.getDate() - 30);
        log.warn(`[${feedKey}] Error reading feed file, defaulting to 30 days ago`);
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

    log.info(`[${feedKey}] Fetching feed from ${feedUrl}...`);

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
        log.info(`[${feedKey}] No new items`);
        return { items: 0, torrents: 0, moviesAdded: 0, moviesStarted: 0 };
      } else {
        const stats = await orchestrator.processNew(newItems, feedKey);

        log.info('');
        log.info(`┌─ [${feedKey}] Processing ─────────────────────────────────`);
        log.info(`│  RSS Items:     ${newItems.length}`);
        log.info(`│  Torrents:      ${stats.torrents} (${stats.torrentsAdded} added to qBit)`);
        log.info(`│  Filtering:     ${stats.filterSummary}`);
        log.info(`│  Added:         ${stats.moviesAdded}`);
        log.info(`│  Downloading:   ${stats.moviesStarted}`);

        if (stats.downloadingDetails && stats.downloadingDetails.length > 0) {
          log.info(`│  Details:`);
          for (const movie of stats.downloadingDetails) {
            log.info(`│    - ${movie.name} (${movie.size} GB)`);
          }
        }

        log.info('└────────────────────────────────────────────────────────────');
        log.info('');

        this.lastPubDates[feedKey] = new Date(newItems[0].pubDate);

        return stats;
      }

    } catch (error) {
      log.error(`[${feedKey}] Error fetching RSS feed from ${feedUrl}:`, error.message);
      await notifier.notifyError(`RSS Feed [${feedKey}]`, `Cannot access ${feedUrl} - ${error.message}`);
    }
  }

  async runChecks() {
    const startTime = new Date();
    log.info('[MAINTENANCE] Running cleanup...');
    const qbittorrent = require('./qbittorrent');
    await qbittorrent.cleanupCompletedTorrents();

    const sessionStats = {
      totalItems: 0,
      totalTorrents: 0,
      totalMoviesAdded: 0,
      totalDownloading: 0,
      feedStats: {}
    };

    for (const [key, path] of Object.entries(config.FEEDS)) {
      const feedStats = await this.checkRSSFeed(key, path);
      if (feedStats) {
        sessionStats.feedStats[key] = feedStats;
        sessionStats.totalItems += feedStats.items;
        sessionStats.totalTorrents += feedStats.torrents;
        sessionStats.totalMoviesAdded += feedStats.moviesAdded;
        sessionStats.totalDownloading += feedStats.moviesStarted;
      }
    }



    const now = new Date();
    const duration = now - startTime;
    const durationSeconds = (duration / 1000).toFixed(1);
    const nextRun = new Date(now.getTime() + config.CHECK_INTERVAL);
    const timeFormat = { hour: '2-digit', minute: '2-digit', hour12: true };

    log.info('');
    log.info('┌─ SESSION COMPLETE ───────────────────────────────────────');
    log.info(`│  Completed: ${now.toLocaleTimeString('en-US', timeFormat)}`);
    log.info(`│  Duration:  ${durationSeconds}s`);
    log.info(`│  Next run:  ${nextRun.toLocaleTimeString('en-US', timeFormat)}`);
    log.info('└──────────────────────────────────────────────────────────');
    log.info('');
  }

  startMonitoring(ignoreFeed = false, days = 2) {
    if (!config.FEEDS || Object.keys(config.FEEDS).length === 0) {
      log.error("No FEEDS configured! Please check your config.");
      return;
    }

    for (const key of Object.keys(config.FEEDS)) {
      this.lastPubDates[key] = this.initializeLastPubDate(key, ignoreFeed, days);
    }

    const intervalMinutes = config.CHECK_INTERVAL / 60000;

    log.info('');
    log.info('┌─ RSS MONITORING ─────────────────────────────────────────');
    log.info(`│  Status: Started (checking every ${intervalMinutes} min)`);
    log.info(`│  Feeds:  ${Object.keys(config.FEEDS).length} enabled`);
    log.info('└──────────────────────────────────────────────────────────');
    log.info('');

    this.runChecks();

    setInterval(() => {
      log.info('Heartbeat - checking RSS feeds...');
      this.runChecks();
    }, config.CHECK_INTERVAL);
  }
}

module.exports = new RSSMonitor();