const axios = require("axios");
const config = require("./config");
const { log } = require("./utils/logger");
const rssMonitor = require("./services/rssMonitor");
const qbittorrent = require("./services/qbittorrent");

// Parse command-line arguments
const args = process.argv.slice(2);
const ignoreFeed = args.includes('--ignore-feed') || args.includes('-i');

// Parse --days parameter (e.g., --days=7, -d=7, or -d 7)
let daysToFetch = 2; // Default 2 days
const daysArg = args.find(arg => arg.startsWith('--days=') || arg.startsWith('-d='));
if (daysArg) {
    const days = parseInt(daysArg.split('=')[1]);
    if (!isNaN(days) && days > 0) {
        daysToFetch = days;
    } else {
        log.error('Invalid --days value. Must be a positive number. Using default: 2 days');
    }
} else {
    // Check for -d flag followed by number (e.g., -d 7)
    const dashDIndex = args.indexOf('-d');
    if (dashDIndex !== -1 && args[dashDIndex + 1]) {
        const days = parseInt(args[dashDIndex + 1]);
        if (!isNaN(days) && days > 0) {
            daysToFetch = days;
        }
    }
}

if (ignoreFeed) {
    log.info(`Running with --ignore-feed flag (ignoring existing feed files)`);
    log.info(`Fetching torrents from the past ${daysToFetch} day(s)`);
}

// Global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
    log.error('UNCAUGHT EXCEPTION - App would have crashed:', error);
    // App keeps running instead of crashing
});

process.on('unhandledRejection', (reason, promise) => {
    log.error('UNHANDLED PROMISE REJECTION:', reason);
    // App keeps running instead of crashing
});

// Graceful shutdown handler
process.on('SIGTERM', () => {
    log.info('SIGTERM received - shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    log.info('SIGINT received - shutting down gracefully');
    process.exit(0);
});

const domainResolver = require("./services/domainResolver"); // Import DomainResolver

// Validate setup on startup
async function validateSetup() {
    const config = ignoreFeed ? `Ignore feeds, fetch ${daysToFetch}d` : 'Use existing feeds';

    log.info('');
    log.info('┌─ STARTUP ────────────────────────────────────────────────');
    log.info(`│  Config:  ${config}`);
    log.info(`│  ───────────────────────────────────────────────────────`);

    // Resolve Domain
    try {
        const domain = await domainResolver.resolve();
        log.info(`│  Domain:  ${domain}`);
    } catch (error) {
        log.error('│  Domain:  ✗ Failed to resolve');
        throw error;
    }

    // Test QBittorrent connection
    try {
        await qbittorrent.login();
        log.info('│  QBit:    ✓ Connected');
    } catch (error) {
        log.error('│  QBit:    ✗ Connection failed');
        log.error('Please check QBITTORRENT_URL, USERNAME, and PASSWORD in .env');
        throw error;
    }

    // Test Radarr connection
    try {
        await axios.get(`${require('./config').RADARR_URL}/api/v3/system/status`, {
            headers: { 'X-Api-Key': require('./config').RADARR_API_KEY },
            timeout: 10000
        });
        log.info('│  Radarr:  ✓ Connected');
    } catch (error) {
        log.error('│  Radarr:  ✗ Connection failed');
        log.error('Please check RADARR_URL and RADARR_API_KEY in .env');
        throw error;
    }

    log.info('└──────────────────────────────────────────────────────────');
    log.info('');
}

// Start the application
validateSetup()
    .then(() => {
        rssMonitor.startMonitoring(ignoreFeed, daysToFetch);
    })
    .catch((error) => {
        log.error('Startup failed:', error);
        process.exit(1);
    });