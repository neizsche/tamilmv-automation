const axios = require("axios");
const { log } = require("./utils/logger");
const config = require("./config");
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
    log.info('Validating setup...');

    // Resolve Domain
    try {
        const domain = await domainResolver.resolve();
        log.success(`Using TamilMV domain: ${domain}`);
    } catch (error) {
        log.error('Failed to resolve TamilMV domain', error);
    }

    // Test QBittorrent connection
    try {
        await qbittorrent.login();
        log.success('QBittorrent connection OK');
    } catch (error) {
        log.error('Cannot connect to QBittorrent', error);
        log.error('Please check QBITTORRENT_URL, USERNAME, and PASSWORD in .env');
        process.exit(1);
    }

    // Test Radarr connection
    try {
        await axios.get(`${config.RADARR_URL}/api/v3/system/status`, {
            headers: { 'X-Api-Key': config.RADARR_API_KEY },
            timeout: 10000
        });
        log.success('Radarr connection OK');
    } catch (error) {
        log.error('Cannot connect to Radarr', error);
        log.error('Please check RADARR_URL and RADARR_API_KEY in .env');
        process.exit(1);
    }

    log.success('All systems ready!');
    log.info('');
}

// Start the application
validateSetup()
    .then(() => {
        // Log enabled feeds
        const enabledFeeds = Object.keys(config.FEEDS);
        if (enabledFeeds.length > 0) {
            log.info(`Enabled Feeds (${enabledFeeds.length}):`);
            enabledFeeds.forEach(key => {
                log.info(`   - ${key}: ${config.FEEDS[key]}`);
            });
        } else {
            log.warning('NO FEEDS ENABLED! Check your .env file.');
        }

        rssMonitor.startMonitoring(ignoreFeed, daysToFetch);
    })
    .catch((error) => {
        log.error('Startup failed:', error);
        process.exit(1);
    });