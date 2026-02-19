const { log } = require('./logger');

const parseArgs = () => {
    const args = process.argv.slice(2);
    const ignoreFeed = args.includes('--ignore-feed') || args.includes('-i');

    // Parse --days parameter (e.g., --days=7, -d=7, or -d 7)
    let daysToFetch = 2; // Default 2 days
    const daysArg = args.find((arg) => arg.startsWith('--days=') || arg.startsWith('-d='));

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

    return { ignoreFeed, daysToFetch };
};

module.exports = { parseArgs };
