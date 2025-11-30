import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const TORRENT_FOLDER = join(__dirname, '..', '..', 'temp', 'torrent_files');
export const TORRENT_URL = `${process.env.QBITTORRENT_URL}/api/v2/torrents`;
export const LOGIN_URL = `${process.env.QBITTORRENT_URL}/api/v2/auth/login`;
export const USERNAME = process.env.QBITTORRENT_USERNAME;
export const PASSWORD = process.env.QBITTORRENT_PASSWORD;
export const RADARR_URL = process.env.RADARR_URL;
export const RADARR_API_KEY = process.env.RADARR_API_KEY;
export const RADARR_QUALITY_PROFILE_ID = 1;
export const RADARR_ROOT_FOLDER = process.env.RADARR_ROOT_FOLDER;
export const FEED_URL = process.env.FEED_URL;
export const CHECK_INTERVAL = 18000000;
export const SCRAPING = {
  MAX_RETRIES: 5,
  DELAY_MS: 1000,
};
export const NTFY = {
  ENABLED: true,
  TOPIC: process.env.NTFY_TOPIC || 'tamilmv-movies',
  SERVER: 'https://ntfy.sh',
};