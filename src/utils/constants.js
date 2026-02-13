const TorrentStates = {
    STOPPED_DL: 'stoppedDL',
    STOPPED_UP: 'stoppedUP',
    STALLED_DL: 'stalledDL',
    DOWNLOADING: 'downloading',
    UPLOADING: 'uploading',
    ERROR: 'error',
    MISSING_FILES: 'missingFiles'
};

const RadarrStatus = {
    NOT_FOUND: 'not_found',
    EXISTS_NO_FILE: 'exists_no_file',
    EXISTS_HAS_FILE: 'exists_has_file'
};

const Timeouts = {
    DEFAULT: 10000,
    RSS_FETCH: 30000,
    DOMAIN_CHECK: 5000,
    FILE_DOWNLOAD: 15000
};

const RetryConfig = {
    MAX_RETRIES: 3,
    INITIAL_DELAY: 1000,
    MAX_DELAY: 10000,
    SCRAPING_MAX_RETRIES: 5,
    SCRAPING_DELAY: 1000
};

const CacheDuration = {
    DOMAIN_IN_MEMORY: 3600000,
    TORRENT_LIST: 30000
};

const FileSizeLimits = {
    MAX_DOMAIN_HISTORY: 5,
    MAX_LOG_SIZE: 20 * 1024 * 1024,
    MAX_LOG_DAYS: 7
};

const ConnectionPool = {
    MAX_SOCKETS: 10,
    KEEP_ALIVE: true
};

const ProgressBar = {
    BAR_LENGTH: 30
};

const LogPrefixes = {
    CLEANUP: '[CLEANUP]',
    STOP: '[STOP]',
    MAINTENANCE: '[MAINTENANCE]',
    FEED: (feedKey) => `[${feedKey}]`
};

module.exports = {
    TorrentStates,
    RadarrStatus,
    Timeouts,
    RetryConfig,
    CacheDuration,
    FileSizeLimits,
    ConnectionPool,
    ProgressBar,
    LogPrefixes
};
