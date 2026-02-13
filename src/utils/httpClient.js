const axios = require('axios');
const http = require('http');
const https = require('https');
const { Timeouts, ConnectionPool } = require('./constants');

const httpAgent = new http.Agent({
    keepAlive: ConnectionPool.KEEP_ALIVE,
    maxSockets: ConnectionPool.MAX_SOCKETS
});

const httpsAgent = new https.Agent({
    keepAlive: ConnectionPool.KEEP_ALIVE,
    maxSockets: ConnectionPool.MAX_SOCKETS
});

const defaultConfig = {
    timeout: Timeouts.DEFAULT,
    httpAgent,
    httpsAgent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
};

function createHttpClient(customConfig = {}) {
    return axios.create({
        ...defaultConfig,
        ...customConfig,
        headers: {
            ...defaultConfig.headers,
            ...(customConfig.headers || {})
        }
    });
}

function createApiClient(baseURL, customConfig = {}) {
    return createHttpClient({
        baseURL,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        ...customConfig
    });
}

function createScraperClient(customConfig = {}) {
    return createHttpClient({
        timeout: Timeouts.RSS_FETCH,
        ...customConfig
    });
}

module.exports = {
    createHttpClient,
    createApiClient,
    createScraperClient,
    httpAgent,
    httpsAgent
};
