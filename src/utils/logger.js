const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

const verboseLogging = process.env.VERBOSE_LOGGING === 'true';

const logDirectory = path.join(__dirname, '..', '..', 'temp', 'logs');

// Ensure log directory exists
if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory);
}

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

// Define format for console
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} [${level.toUpperCase()}] ${message}`;
  }),
  winston.format.colorize({ all: true })
);

// Define format for file
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

const logger = winston.createLogger({
  levels: customLevels.levels,
  level: verboseLogging ? 'debug' : 'info',
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    new DailyRotateFile({
      filename: path.join(logDirectory, 'automation-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '7d',
      format: fileFormat,
      level: 'debug' // Always log everything to file, filter in console if needed, or just follow global level
    }),
  ],
});

const displayProgressBar = (current, total, reason) => {
  const barLength = 30;
  const progress = Math.round((current / total) * barLength);
  const bar = "█".repeat(progress) + "-".repeat(barLength - progress);
  // Using process.stdout directly to avoid newline from logger
  process.stdout.write(`\r[${bar}] (${current}/${total}) (${reason.toUpperCase()})`);
  if (current === total) process.stdout.write("\n\n");
};

// Wrapper to match existing API
const log = {
  info: (message) => logger.info(message),
  success: (message) => logger.log('success', message), // Custom level needs .log
  warning: (message) => logger.warning(message),
  debug: (message) => logger.debug(message),
  error: (message, error = null) => {
    let msg = message;
    if (error) {
      if (error.stack) {
        msg += `\n${error.stack}`;
      } else {
        msg += ` - ${error.message || error}`;
      }
    }
    logger.error(msg);
  },
};

module.exports = { displayProgressBar, log };