const axios = require('axios');
const config = require('../config');
const { log } = require('../utils/logger');
const qbittorrent = require('./qbittorrent');
const domainResolver = require('./domainResolver');

async function validateSetup(ignoreFeed, daysToFetch) {
    const configStr = ignoreFeed ? `Ignore feeds, fetch ${daysToFetch}d` : 'Use existing feeds';

    log.info('');
    log.info('┌─ STARTUP ────────────────────────────────────────────────');
    log.info(`│  Config:  ${configStr}`);
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
        await axios.get(`${config.RADARR_URL}/api/v3/system/status`, {
            headers: { 'X-Api-Key': config.RADARR_API_KEY },
            timeout: 10000,
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

module.exports = { validateSetup };
