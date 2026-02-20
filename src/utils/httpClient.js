const axios = require('axios');
const http = require('http');
const https = require('https');
const config = require('../config');
const { log } = require('./logger');
const { wait } = require('./helpers');

// HTTP connection pooling for better performance
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

// Default generic HTTP client with standard browser User-Agent
const defaultClient = axios.create({
    timeout: 30000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    httpAgent,
    httpsAgent,
});

// Dedicated Radarr HTTP client
const radarrClient = axios.create({
    baseURL: config.RADARR_URL,
    timeout: 10000,
    headers: {
        'X-Api-Key': config.RADARR_API_KEY,
        'Content-Type': 'application/json',
    },
    httpAgent,
    httpsAgent,
});

// Dedicated qBittorrent HTTP Client
const qbitClient = axios.create({
    timeout: 10000,
    httpAgent,
    httpsAgent,
});

// Notification HTTP Client
const ntfyClient = axios.create({
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
    },
    httpAgent,
    httpsAgent,
});


// Retry utility with exponential backoff
const retryWithBackoff = async (
    fn,
    maxRetries = 3,
    initialDelayMs = 1000,
    operationName = 'operation'
) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries) {
                // Last attempt failed, throw the error
                throw error;
            }

            const delay = initialDelayMs * Math.pow(2, attempt - 1); // Exponential backoff
            log.warning(
                `${operationName} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`
            );
            await wait(delay);
        }
    }
};

module.exports = {
    defaultClient,
    radarrClient,
    qbitClient,
    ntfyClient,
    retryWithBackoff,
};
