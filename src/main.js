const { log } = require('./utils/logger');
const rssMonitor = require('./services/rssMonitor');
const { parseArgs } = require('./utils/args');
const { validateSetup } = require('./services/startup');

// Parse command-line arguments
const { ignoreFeed, daysToFetch, reset } = parseArgs();

if (reset) {
    const fs = require('fs');
    const config = require('./config');
    const { ensureFolderExists } = require('./utils/helpers');

    log.info('Running with --reset flag. Clearing feed cache...');
    if (fs.existsSync(config.FEED_FOLDER)) {
        fs.rmSync(config.FEED_FOLDER, { recursive: true, force: true });
        log.info('Feed cache cleared.');
    }
    ensureFolderExists(config.FEED_FOLDER);
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

process.on('unhandledRejection', (reason) => {
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

// ... (existing code)

// Start the application
validateSetup(ignoreFeed, daysToFetch)
    .then(async () => {
        try {
            // Initialize State Cache
            await rssMonitor.startMonitoring(ignoreFeed, daysToFetch);
        } catch (error) {
            log.error('Failed to initialize state cache:', error);
            process.exit(1);
        }
    })
    .catch((error) => {
        log.error('Startup failed:', error);
        process.exit(1);
    });
