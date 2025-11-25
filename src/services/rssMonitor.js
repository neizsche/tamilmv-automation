const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");
const fs = require("fs");
const config = require("../config");
const torrentProcessor = require("../processors/torrentProcessor");
const { log } = require("../utils/logger");
const notifier = require("./notifier");

class RSSMonitor {
  constructor() {
    this.parser = new XMLParser();
    this.lastPubDate = this.initializeLastPubDate();
  }

  initializeLastPubDate() {
    if (!fs.existsSync("feed.xml")) {
      const date = new Date();
      date.setDate(date.getDate() - 2);
      log.info(`Initialized lastPubDate to: ${date}`);
      return date;
    } else {
      try {
        const feedContent = fs.readFileSync("feed.xml", "utf-8");
        const feed = this.parser.parse(feedContent);
        const lastItem = feed.rss.channel.item[0];
        const date = new Date(lastItem.pubDate);
        log.info(`Initialized lastPubDate to the date of the last item: ${date}`);
        return date;
      } catch (error) {
        const date = new Date();
        date.setDate(date.getDate() - 30);
        return date;
      }
    }
  }

  async checkRSSFeed() {  // REMOVE the url parameter
    const url = config.FEED_URL;  // Use config directly
    
    // Validate URL
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      log.error(`Invalid RSS feed URL: ${url}`);
      await notifier.notifyError("RSS Feed", `Invalid URL: ${url}`);
      return;
    }

    try {
      log.info(`Checking RSS feed: ${url}`);
      
      const response = await axios.get(url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      fs.writeFileSync("feed.xml", response.data);
      
      const feedContent = fs.readFileSync("feed.xml", "utf-8");
      const feed = this.parser.parse(feedContent);
      const items = Array.isArray(feed.rss.channel.item) ? feed.rss.channel.item : [feed.rss.channel.item];
      const newItems = [];

      for (const item of items) {
        const itemDate = new Date(item.pubDate);
        if (itemDate <= this.lastPubDate) break;
        newItems.push(item);
      }

      if (newItems.length === 0) {
        log.info("No new items found.");
      } else {
        log.info(`Found ${newItems.length} new items`);
        await torrentProcessor.processNewItems(newItems);
        this.lastPubDate = new Date(newItems[0].pubDate);
        log.info(`Updated lastPubDate to: ${this.lastPubDate}`);
      }
    } catch (error) {
      log.error(`Error fetching RSS feed from ${url}:`, error.message);
      await notifier.notifyError("RSS Feed", `Cannot access ${url} - ${error.message}`);
    }
  }

  startMonitoring() {
    this.checkRSSFeed();  // Call without parameter
    setInterval(() => this.checkRSSFeed(), config.CHECK_INTERVAL);  // Call without parameter
  }
}

module.exports = new RSSMonitor();