const { defaultClient } = require('../utils/httpClient');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { log } = require('../utils/logger');
const { ensureFolderExists } = require('../utils/helpers');

const CACHE_FILE = path.resolve(__dirname, '../../temp/domain_cache.json');

class DomainResolver {
    constructor() {
        this.domains = config.TAMILMV_DOMAINS;
        this.currentDomain = this.domains[0]; // Default to first domain
        this.checkedDate = null;
    }

    async resolve() {
        if (this.checkedDate && Date.now() - this.checkedDate < 3600000) {
            return this.currentDomain;
        }

        const diskCache = this.loadCache();
        const learnedDomains =
            diskCache && Array.isArray(diskCache.workingDomains) ? diskCache.workingDomains : [];

        if (diskCache && diskCache.domain && !learnedDomains.includes(diskCache.domain)) {
            learnedDomains.unshift(diskCache.domain);
        }

        const allDomains = [...new Set([...learnedDomains, ...this.domains])];

        for (const domain of allDomains) {
            try {
                const start = Date.now();
                await defaultClient.head(domain, { timeout: 5000 });

                this.currentDomain = domain;
                this.checkedDate = Date.now();
                this.saveCache(domain);

                return domain;
            } catch (error) {
                continue;
            }
        }

        throw new Error('All TamilMV domains are unreachable');
    }

    loadCache() {
        try {
            if (fs.existsSync(CACHE_FILE)) {
                const data = fs.readFileSync(CACHE_FILE, 'utf-8');
                return JSON.parse(data);
            }
        } catch (error) {
            log.debug(`Failed to load domain cache: ${error.message}`);
        }
        return null;
    }

    saveCache(workingDomain) {
        try {
            ensureFolderExists(path.dirname(CACHE_FILE));

            // Load existing to preserve history
            const currentCache = this.loadCache() || {};
            let history = Array.isArray(currentCache.workingDomains)
                ? currentCache.workingDomains
                : [];

            // Migration: if old format exists, include it
            if (currentCache.domain && !history.includes(currentCache.domain)) {
                history.push(currentCache.domain);
            }

            // Remove the domain if it's already there (to move it to front)
            history = history.filter((d) => d !== workingDomain);

            // Add to front
            history.unshift(workingDomain);

            // Keep max 5
            if (history.length > 5) {
                history = history.slice(0, 5);
            }

            fs.writeFileSync(
                CACHE_FILE,
                JSON.stringify(
                    {
                        workingDomains: history,
                        updated: new Date().toISOString(),
                    },
                    null,
                    2
                )
            );

            log.debug(`💾 Updated domain history: ${JSON.stringify(history)}`);
        } catch (error) {
            log.error(`Failed to save domain cache: ${error.message}`);
        }
    }

    getUrl(path) {
        // Ensure path starts with / if not empty
        const cleanPath = path.startsWith('/') ? path : `/${path}`;
        return `${this.currentDomain}${cleanPath}`;
    }
}

module.exports = new DomainResolver();
