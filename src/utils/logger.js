const winston = require('winston');
const path = require('path');
const fs = require('fs');

const verboseLogging = process.env.VERBOSE_LOGGING === 'true';

const logDirectory = path.join(__dirname, '..', '..', 'temp', 'logs');

// Ensure log directory exists
fs.mkdirSync(logDirectory, { recursive: true });

// Custom log levels
const customLevels = {
    levels: {
        error: 0,
        warning: 1,
        success: 2,
        info: 3,
        debug: 4,
    },
    colors: {
        error: 'red',
        warning: 'yellow',
        success: 'green',
        info: 'blue',
        debug: 'gray',
    },
};

winston.addColors(customLevels.colors);

const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
        return `${timestamp} [${level.toUpperCase()}] ${message}`;
    }),
    winston.format.colorize({ all: true })
);

const fileFormat = winston.format.combine(winston.format.timestamp(), winston.format.json());

const logger = winston.createLogger({
    levels: customLevels.levels,
    level: verboseLogging ? 'debug' : 'info',
    transports: [
        new winston.transports.Console({ format: consoleFormat }),
        new winston.transports.File({
            filename: path.join(logDirectory, 'app.log'),
            format: fileFormat,
            level: 'debug',
        }),
    ],
});

const log = {
    info: (message) => logger.info(message),
    success: (message) => logger.log('success', message),
    warning: (message) => logger.warning(message),
    debug: (message) => logger.debug(message),
    error: (message, error = null) => {
        let msg = message;
        if (error) {
            msg += error.stack ? `\n${error.stack}` : ` - ${error.message || error}`;
        }
        logger.error(msg);
    },
};

const setVerbose = (verbose) => {
    logger.level = verbose ? 'debug' : 'info';
};

module.exports = { log, setVerbose };
