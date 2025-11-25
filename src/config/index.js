const path = require("path");
require('dotenv').config();

module.exports = {
  TORRENT_FOLDER: path.join(__dirname, "..", "..", "temp", "torrent_files"),
  TORRENT_URL: `${process.env.QBITTORRENT_URL}/api/v2/torrents`,
  LOGIN_URL: `${process.env.QBITTORRENT_URL}/api/v2/auth/login`,
  USERNAME: process.env.QBITTORRENT_USERNAME,
  PASSWORD: process.env.QBITTORRENT_PASSWORD,
  RADARR_URL: process.env.RADARR_URL,
  RADARR_API_KEY: process.env.RADARR_API_KEY,
  RADARR_QUALITY_PROFILE_ID: 1,
  RADARR_ROOT_FOLDER: process.env.RADARR_ROOT_FOLDER,
  FEED_URL: process.env.FEED_URL,
  CHECK_INTERVAL: 18000000,
  SCRAPING: {
    MAX_RETRIES: 5,
    DELAY_MS: 1000
  },
  NTFY: {
    ENABLED: true,
    TOPIC: process.env.NTFY_TOPIC || "tamilmv-movies",
    SERVER: "https://ntfy.sh"
  }
};