const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { log, setVerbose } = require('../utils/logger');

// Validate required environment variables on startup
const REQUIRED_VARS = [
    'QBITTORRENT_URL',
    'QBITTORRENT_USERNAME',
    'QBITTORRENT_PASSWORD',
    'RADARR_URL',
    'RADARR_API_KEY',
    'RADARR_ROOT_FOLDER',
];

const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
    log.error(`Missing required environment variables: ${missing.join(', ')}`);
    log.error('Please check your .env file against .env.example');
    process.exit(1);
}

// Validate URL formats
const urlVars = ['QBITTORRENT_URL', 'RADARR_URL'];
for (const varName of urlVars) {
    const url = process.env[varName];
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
        log.error(`Invalid URL format for ${varName}: ${url}`);
        log.error('URLs must start with http:// or https://');
        process.exit(1);
    }
}

const config = {
    TORRENT_FOLDER: path.join(__dirname, '..', '..', 'temp', 'torrent_files'),
    FEED_FOLDER: path.join(__dirname, '..', '..', 'temp', 'feeds'),
    TORRENT_URL: `${process.env.QBITTORRENT_URL}/api/v2/torrents`,
    LOGIN_URL: `${process.env.QBITTORRENT_URL}/api/v2/auth/login`,
    USERNAME: process.env.QBITTORRENT_USERNAME,
    PASSWORD: process.env.QBITTORRENT_PASSWORD,
    RADARR_URL: process.env.RADARR_URL,
    RADARR_API_KEY: process.env.RADARR_API_KEY,
    RADARR_QUALITY_PROFILE_ID: parseInt(process.env.RADARR_QUALITY_PROFILE_ID) || 1,
    RADARR_ROOT_FOLDER: process.env.RADARR_ROOT_FOLDER,

    // RSS Feeds Configuration
    FEEDS: (() => {
        const knownFeeds = {
            malayalam_hd: 'index.php?/forums/forum/36-web-hd-itunes-hd-bluray.xml',
            hindi_hd: 'index.php?/forums/forum/58-web-hd-itunes-hd-bluray.xml',
            tamil_hd: 'index.php?/forums/forum/11-web-hd-itunes-hd-bluray.xml',
            telugu_hd: 'index.php?/forums/forum/24-web-hd-itunes-hd-bluray.xml',
            kannada_hd: 'index.php?/forums/forum/69-web-hd-itunes-hd-bluray.xml',
            english_hd: 'index.php?/forums/forum/49-web-hd-itunes-hd-bluray.xml',
        };

        const feeds = {};

        // Enable known feeds via env
        if (process.env.ENABLE_MALAYALAM_HD === 'true')
            feeds.malayalam_hd = knownFeeds.malayalam_hd;
        if (process.env.ENABLE_HINDI_HD === 'true') feeds.hindi_hd = knownFeeds.hindi_hd;
        if (process.env.ENABLE_TAMIL_HD === 'true') feeds.tamil_hd = knownFeeds.tamil_hd;
        if (process.env.ENABLE_TELUGU_HD === 'true') feeds.telugu_hd = knownFeeds.telugu_hd;
        if (process.env.ENABLE_KANNADA_HD === 'true') feeds.kannada_hd = knownFeeds.kannada_hd;
        if (process.env.ENABLE_ENGLISH_HD === 'true') feeds.english_hd = knownFeeds.english_hd;

        // Custom feed support
        if (process.env.CUSTOM_FEED_NAME && process.env.CUSTOM_FEED_PATH) {
            feeds[process.env.CUSTOM_FEED_NAME] = process.env.CUSTOM_FEED_PATH;
        }

        return feeds;
    })(),

    CHECK_INTERVAL: parseInt(process.env.CHECK_INTERVAL_MINUTES) * 60000 || 600000, // Default 10 minutes

    // QBittorrent settings
    QBITTORRENT: {
        CATEGORY_ACTIVE: process.env.QBITTORRENT_CATEGORY_ACTIVE || 'radarr',
        CATEGORY_COMPLETED: process.env.QBITTORRENT_CATEGORY_COMPLETED || '~completed',
        TAG: process.env.QBITTORRENT_TAG || 'tamilmv',
    },

    TORRENT_SIZE: {
        MIN_GB: parseFloat(process.env.TORRENT_MIN_SIZE_GB) || 1,
        MAX_GB: parseFloat(process.env.TORRENT_MAX_SIZE_GB) || 3,
    },

    // TamilMV Domains (Prioritized list)
    TAMILMV_DOMAINS: [
        'https://www.1tamilmv.rsvp',
        'https://www.1tamilmv.fi',
        'https://www.1tamilmv.pink',
        'https://www.1tamilmv.com',
        'https://www.1tamilmv.net',
        'https://www.1tamilmv.org',
        'https://www.1tamilmv.ch',
    ],

    SCRAPING: {
        MAX_RETRIES: parseInt(process.env.SCRAPING_MAX_RETRIES) || 5,
        DELAY_MS: parseInt(process.env.SCRAPING_DELAY_MS) || 1000,
    },
    NTFY: {
        ENABLED: process.env.NTFY_ENABLED === 'true' || false,
        TOPIC: process.env.NTFY_TOPIC || 'tamilmv-movies',
        SERVER: process.env.NTFY_SERVER || 'https://ntfy.sh',
    },
    VERBOSE_LOGGING: true,
};

// Set log level based on final config (guard for test environments where mock may not include it)
if (typeof setVerbose === 'function') setVerbose(config.VERBOSE_LOGGING);

module.exports = config;
