const { log } = require('./utils/logger');
const rssMonitor = require('./services/rssMonitor');
const { parseArgs } = require('./utils/args');
const { validateSetup } = require('./services/startup');

// Parse command-line arguments
const { ignoreFeed, daysToFetch } = parseArgs();

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

// Start the application
validateSetup(ignoreFeed, daysToFetch)
    .then(() => {
        rssMonitor.startMonitoring(ignoreFeed, daysToFetch);
    })
    .catch((error) => {
        log.error('Startup failed:', error);
        process.exit(1);
    });
