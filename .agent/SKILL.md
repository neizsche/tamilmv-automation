# TamilMV Automation - AI Reference Guide

**Last Updated**: 2026-02-13  
**Version**: 2.0

This document serves as a comprehensive reference for AI/LLMs working on the tamilmv-automation project. It contains architecture patterns, conventions, and guidelines that should be followed when making changes.

---

## 📋 Project Overview

**Purpose**: Automated torrent downloading system that monitors TamilMV RSS feeds, filters content, integrates with Radarr for media management, and uses QBittorrent for downloading.

**Key Technologies**:

- Node.js runtime
- External APIs: QBittorrent WebUI, Radarr API, ntfy.sh
- File-based storage: CSV logs, JSON cache, RSS feeds

---

## 🏗️ Architecture

### Directory Structure

```
src/
├── main.js                 # Entry point - startup & validation
├── config/
│   └── index.js            # Centralized configuration
├── services/               # External service integrations
│   ├── domainResolver.js   # TamilMV domain resolution with failover
│   ├── notifier.js         # ntfy.sh notifications
│   ├── qbittorrent.js      # QBittorrent API client
│   ├── radarr.js           # Radarr API client
│   └── rssMonitor.js       # RSS feed monitoring
├── processors/             # Business logic (modular pipeline)
│   ├── orchestrator.js     # Main coordinator
│   ├── downloader.js       # File download/cleanup
│   ├── scraper.js          # Link extraction
│   ├── filter.js           # Size/duplicate filtering
│   └── radarr.js           # Radarr integration
└── utils/                  # Shared utilities
    ├── constants.js        # All magic numbers
    ├── csvLogger.js        # Torrent lifecycle logging
    ├── errorPatterns.js    # Standard error handling
    ├── helpers.js          # Utility functions
    ├── httpClient.js       # HTTP client factory
    └── logger.js           # Winston logging
```

### Layered Design

```
Entry Point (main.js)
    ↓
Service Layer (services/)
    ↓
Processor Layer (processors/)
    ↓
Utilities (utils/)
```

---

## 🎯 Core Workflow

### RSS Monitoring Loop

```
1. rssMonitor checks feeds every CHECK_INTERVAL
2. Filters new items by lastPubDate
3. Passes new items to orchestrator.processNew()
4. Runs cleanup (qbittorrent.cleanupCompletedTorrents())
```

### Torrent Processing Pipeline

```
orchestrator.processNew(items)
    ↓
scraper.scrapeAll(items) → Extract torrent links
    ↓
downloader.download() + qbittorrent.addTorrent() → Add to QBittorrent (stopped)
    ↓
filter.applyAll() → Size + duplicate filtering
    ↓
radarr.categorize() → Check Radarr status
    ↓
radarr.addMovies() → Add missing movies
    ↓
qbittorrent.manageTorrents() → Delete/Start torrents
    ↓
csvLogger → Log lifecycle events
```

### Cleanup Workflow

```
qbittorrent.cleanupCompletedTorrents()
    ↓
_stopFullyDownloadedTorrents() → Stop 100% complete torrents
    ↓
_deleteCompletedTorrents() → Delete from 'completed' category
    ↓
_deleteStalledTorrents() → Delete stalled/errored/missing
```

---

## 📐 Design Patterns

### 1. Singleton Pattern

**Used in**: All services and processors
**Why**: Shared state (sessions, caches, connections)
**Implementation**: Export single instance via `module.exports = new ClassName()`

### 2. Modular Pipeline

**Used in**: Processor layer
**Why**: Single responsibility, easy to test/extend
**Modules**: downloader → scraper → filter → radarr → orchestrator

### 3. Result Pattern

**Used in**: errorPatterns utility
**Why**: Explicit success/failure without exceptions
**Structure**: `{ success: boolean, data: any, message: string, error: Error }`

### 4. Factory Pattern

**Used in**: httpClient utility
**Why**: Consistent HTTP config, connection pooling
**Functions**: `createHttpClient()`, `createApiClient()`, `createScraperClient()`

---

## 🔧 Key Conventions

### 1. Function Naming

- **Concise & contextual**: Since modules are already in specific directories, avoid redundant prefixes
- Examples:
    - `downloader.download()` not `downloader.downloadFile()`
    - `scraper.scrapeLinks()` not `scraper.scrapeTorrentLinks()`
    - `filter.bySize()` not `filter.filterBySize()`

### 2. File Naming

- **Context-aware**: No redundant prefixes when context is clear
- Examples:
    - `processors/downloader.js` not `processors/torrentDownloader.js`
    - `processors/orchestrator.js` not `processors/torrentOrchestrator.js`

#### filter

**Responsibility**: Torrent filtering logic

**Class**: `TorrentFilter` (Singleton)

**Key Methods**:

```javascript
bySize(torrents);
removeDuplicates(torrents);
applyAll(torrents);
```

**Filtering Criteria**:

1. **Size Filter**: Remove torrents outside MIN_GB to MAX_GB range
2. **Duplicate Filter**:
    - Keep best quality per movie (by progress or size)
    - **Cross-feed detection**: Checks ALL torrents in QBittorrent (not just stopped)
    - Prevents same movie from being added multiple times from different language feeds

### 3. Documentation

- **No JSDoc** (per user preference)
- Code should be self-documenting with clear names
- Add inline comments only for complex logic

### 4. Error Handling

- **Silent failures**: Scraping, individual torrent processing (log and continue)
- **Logged failures**: API errors, file operations
- **Fatal failures**: Startup validation, config errors (exit process)
- **Retry logic**: Use for API calls (3-5 retries with exponential backoff)

### 5. Async Patterns

- **Always use async/await** (no .then() chains)
- Use `Promise.allSettled()` for parallel operations where individual failures shouldn't stop others
- Use `Promise.all()` only when all must succeed

### 6. Module Exports

- Services/processors: Export singleton instance
- Utilities: Export object with functions
- Constants: Export object with grouped constants

---

## 🔑 Important Implementation Details

### QBittorrent Integration

- **Session management**: Uses SID cookie, stored in `this.sid`
- **Auto re-auth**: Catches 403 errors and re-authenticates automatically
- **File handling**: Uses `readFileSync` to avoid file handle leaks
- **Actions**: `delete`, `stop`, `start` - use correct API endpoints
    - ⚠️ **Critical**: Use `stop` not `pause` for stopping torrents

### Radarr Integration

- **Connection pooling**: HTTP agent with keepAlive and maxSockets: 10
- **Duplicate checks**: Multiple strategies (lookup property + TMDB query)
- **Parallel operations**: Batch movie additions with `Promise.allSettled()`
- **Unmonitored by default**: Movies are added with `monitored: false`
    - ✅ **Prevents active searches**: Radarr won't search for upgrades automatically
    - ✅ **Allows imports**: QBittorrent files are still imported regardless of monitoring status
    - 🎯 **Why**: We manage downloads ourselves, Radarr just handles the library
- **Re-check on failed additions**: When `addMovie()` fails because movie exists, re-check if it has a file
    - If has file → set `downloading = false` → torrent will be deleted
    - If no file → keep `downloading = true` → torrent will download

### Domain Resolution

- **In-memory cache**: 1 hour TTL
- **Persistent history**: Max 5 domains, priority to recent successes
- **Latency-based**: Measures response time for selection

### Configuration

- **Validation on startup**: Required vars, URLs, numeric ranges
- **Dynamic feeds**: Enable/disable via environment variables
- **Magic numbers**: All in `constants.js`, never hardcoded

### File Operations

- **Atomic writes**: Use temp file + rename pattern
- **Cleanup**: Always clean up temp files in try/catch/finally
- **Verification**: Check file exists and size > 0 after download

---

## 🚨 Critical Rules

### When Making Changes

1. **Adding a new processor module**:
    - Create in `src/processors/`
    - Export as singleton
    - Update `orchestrator.js` to integrate
    - Use concise, contextual naming

2. **Adding a new service**:
    - Create in `src/services/`
    - Export as singleton
    - Add configuration to `config/index.js`
    - Add any new constants to `utils/constants.js`

3. **Modifying HTTP calls**:
    - Use `httpClient.js` factory functions
    - Don't create new axios instances directly
    - Connection pooling is already configured

4. **Error handling**:
    - Use `errorPatterns.js` for Result pattern
    - Add retry logic for external APIs
    - Log errors with `logger.error()`
    - Don't let individual failures stop batch operations

5. **Configuration changes**:
    - Add to `.env.example`
    - Add to `config/index.js` with validation
    - Document in README.md

6. **Constants**:
    - Add to `utils/constants.js` grouped by category
    - Never hardcode timeouts, retries, sizes, etc.

---

## 📝 Common Tasks

### Add a New RSS Feed Type

1. Add env var to `.env.example`: `ENABLE_NEWTYPE_HD=true`
2. Add feed path to `config/index.js` in `knownFeeds` object
3. Add enable check in `FEEDS` configuration builder
4. Update README.md with new feed option

### Add a New Filtering Rule

1. Add method to `processors/filter.js`
2. Call from `applyAll()` method
3. Log filter actions with `[FILTER]` prefix
4. Return `{ filtered, removed }` structure

### Add a New Cleanup Operation

1. Add private method to `services/qbittorrent.js` (e.g., `_deleteOldTorrents()`)
2. Call from `cleanupCompletedTorrents()` method
3. Use `_processTorrentBatch()` helper for logging + action
4. Return count of affected torrents

### Add Error Notifications

1. Use `notifier.notifyError(operation, error)` from `services/notifier.js`
2. Check `config.NTFY.ENABLED` before sending
3. Provide clear operation context in message

### Add Metrics/Logging

1. Use `csvLogger` for torrent lifecycle events
2. Use `logger.info/success/warning/error()` for application logs
3. Use `[PREFIX]` format for log messages (see `constants.LogPrefixes`)

---

## 🧪 Testing Guidelines

While there are no automated tests currently, when adding them:

1. Use Jest as the test framework
2. Mock external dependencies (QBittorrent, Radarr APIs)
3. Test utilities and processors independently
4. Create fixtures in `test/fixtures/`
5. Focus on:
    - Filter logic (size, duplicates)
    - Movie name parsing
    - Error handling and retries
    - Configuration validation

---

## 🔄 Dependency Map

When modifying a component, be aware of dependencies:

```
main.js → config, rssMonitor, qbittorrent, domainResolver, logger
rssMonitor → orchestrator, qbittorrent, domainResolver, notifier
orchestrator → downloader, scraper, filter, radarr, qbittorrent
downloader → httpClient, constants
scraper → httpClient, constants
filter → qbittorrent, constants
radarr (processor) → radarr (service)
qbittorrent → config, logger, csvLogger
radarr (service) → config, logger, notifier, helpers
```

---

## 📊 Key Files Reference

### Essential Files (Always Review Before Changes)

**config/index.js**

- All environment variable definitions
- Feed configuration
- Validation logic
- Change this when adding new configs

**processors/orchestrator.js**

- Main workflow coordinator
- Entry point for RSS processing
- Change this when modifying pipeline

**services/qbittorrent.js**

- QBittorrent API client
- Session management
- Cleanup logic
- Change this for QBittorrent operations

**utils/constants.js**

- All magic numbers
- Timeout values
- Retry configurations
- State definitions
- Change this instead of hardcoding values

---

## 🎨 Code Style

### Preferred Patterns

✅ **Good**:

```javascript
async function processItems(items) {
    const results = await Promise.allSettled(items.map((item) => processItem(item)));

    for (const result of results) {
        if (result.status === 'fulfilled') {
            // handle success
        } else {
            log.error('Failed', result.reason);
        }
    }
}
```

❌ **Avoid**:

```javascript
async function processItems(items) {
    for (const item of items) {
        try {
            await processItem(item);
        } catch (error) {
            // swallowing errors silently
        }
    }
}
```

### Import Order

1. Node built-ins (fs, path, http)
2. External packages (axios, cheerio)
3. Project modules (./config, ./services, ./utils)

### Variable Naming

- **Descriptive**: `torrentsToDelete` not `arr`
- **Consistent**: Use same names across modules (e.g., always `torrents` not sometimes `torrentList`)
- **Clear intent**: `downloadSuccess` not `success`

---

## 🚀 Deployment Notes

### Environment Requirements

- Node.js v20+
- QBittorrent with WebUI enabled
- Radarr (optional but recommended)

### Configuration Files

- `.env` - Never commit (contains secrets)
- `.env.example` - Template, safe to commit
- `temp/domain_cache.json` - Runtime cache
- `temp/feeds/*.xml` - RSS feed storage

### Logs Location

- Application logs: `temp/logs/application-YYYY-MM-DD.log`
- CSV audit: `temp/torrent_lifecycle_log.csv`

---

## 🔄 Change Protocol

### When You Modify Code

1. **Update this file** if you change:
    - Architecture/structure
    - Design patterns
    - Key conventions
    - Workflow logic
    - Important implementation details

2. **Update design_document.md** (in .agent/docs) if you change:
    - Component designs
    - API contracts
    - Data flow diagrams

3. **Update README.md** if you change:
    - User-facing features
    - Configuration options
    - Setup/installation steps

4. **Update .env.example** if you add:
    - New environment variables

### Maintaining Consistency

This project follows specific conventions that must be maintained:

- ✅ Singleton exports for services/processors
- ✅ Concise, contextual function names
- ✅ No JSDoc comments
- ✅ All constants in constants.js
- ✅ HTTP clients from httpClient.js
- ✅ Error handling with Result pattern

---

## 📞 Quick Reference

### Get Current Domain

```javascript
const domain = domainResolver.getCurrentDomain();
const url = domainResolver.getUrl('/path');
```

### Add Torrent to QBittorrent

```javascript
const success = await qbittorrent.addTorrent(filePath);
```

### Check Movie in Radarr

```javascript
const status = await radarr.checkMovieStatus(torrentName);
// Returns: { exists: boolean, hasFile: boolean, title, year }
```

### Log Torrent Event

```javascript
csvLogger.logAdded(movieName, sizeBytes);
csvLogger.logRemoved(movieName, sizeBytes);
```

### Send Notification

```javascript
notifier.notifyMovieAdded(title, year);
notifier.notifyError(operation, error);
```

### Create HTTP Client

```javascript
const client = createScraperClient({ timeout: 5000 });
const response = await client.get(url);
```

---

## 🎯 Remember

1. **Keep modules focused**: Each processor module has ONE responsibility
2. **Use constants**: Never hardcode timeouts, retries, sizes
3. **Handle errors gracefully**: Log and continue, don't crash
4. **Maintain singleton pattern**: Services need shared state
5. **Update this file**: Keep it current as the single source of truth

This project prioritizes **clarity, modularity, and maintainability** over brevity. Make changes that align with these principles.
