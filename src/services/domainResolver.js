const axios = require("axios");
const fs = require("fs");
const path = require("path");
const config = require("../config");
const { log } = require("../utils/logger");
const { ensureFolderExists } = require("../utils/helpers");

const CACHE_FILE = path.resolve(__dirname, "../../temp/domain_cache.json");

class DomainResolver {
    constructor() {
        this.domains = config.TAMILMV_DOMAINS;
        this.currentDomain = this.domains[0]; // Default to first domain
        this.checkedDate = null;
    }

    async resolve() {
        // If we checked recently (last 1 hour), return cached in-memory domain
        if (this.checkedDate && (Date.now() - this.checkedDate < 3600000)) {
            return this.currentDomain;
        }

        // 1. Load "learned" domains from cache
        const diskCache = this.loadCache();
        const learnedDomains = diskCache && Array.isArray(diskCache.workingDomains)
            ? diskCache.workingDomains
            : [];

        // Handle migration from old single-domain cache format if present
        if (diskCache && diskCache.domain && !learnedDomains.includes(diskCache.domain)) {
            learnedDomains.unshift(diskCache.domain);
        }

        log.info(`🔍 Resolving fastest working TamilMV domain...`);
        if (learnedDomains.length > 0) {
            log.debug(`Loaded ${learnedDomains.length} learned domains from history`);
        }

        // 2. Combine learned domains with config domains (learned first)
        // Set removes duplicates
        const allDomains = [...new Set([...learnedDomains, ...this.domains])];

        for (const domain of allDomains) {
            try {
                log.debug(`Checking connectivity to: ${domain}`);
                const start = Date.now();
                await axios.head(domain, { timeout: 5000 });
                const latency = Date.now() - start;

                log.success(`✅ Domain reachable: ${domain} (${latency}ms)`);
                this.currentDomain = domain;
                this.checkedDate = Date.now();

                // 3. Save to disk (updates the history)
                this.saveCache(domain);

                return domain;
            } catch (error) {
                log.warning(`❌ Domain unreachable: ${domain} - ${error.message}`);
            }
        }

        log.error("🔥 ALL DOMAINS UNREACHABLE! Using default fallback.");
        return this.currentDomain; // Return last known or default
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
            let history = Array.isArray(currentCache.workingDomains) ? currentCache.workingDomains : [];

            // Migration: if old format exists, include it
            if (currentCache.domain && !history.includes(currentCache.domain)) {
                history.push(currentCache.domain);
            }

            // Remove the domain if it's already there (to move it to front)
            history = history.filter(d => d !== workingDomain);

            // Add to front
            history.unshift(workingDomain);

            // Keep max 5
            if (history.length > 5) {
                history = history.slice(0, 5);
            }

            fs.writeFileSync(CACHE_FILE, JSON.stringify({
                workingDomains: history,
                updated: new Date().toISOString()
            }, null, 2));

            log.debug(`💾 Updated domain history: ${JSON.stringify(history)}`);
        } catch (error) {
            log.error(`Failed to save domain cache: ${error.message}`);
        }
    }

    getCurrentDomain() {
        return this.currentDomain;
    }

    getUrl(path) {
        // Ensure path starts with / if not empty
        const cleanPath = path.startsWith("/") ? path : `/${path}`;
        return `${this.currentDomain}${cleanPath}`;
    }
}

module.exports = new DomainResolver();
