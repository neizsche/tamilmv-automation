const domainResolver = require('../../../src/services/domainResolver');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../../../src/config');
const { ensureFolderExists } = require('../../../src/utils/helpers');
const { log } = require('../../../src/utils/logger');

jest.mock('axios');
jest.mock('fs');
jest.mock('path', () => {
    const originalPath = jest.requireActual('path');
    return {
        ...originalPath,
        resolve: jest.fn().mockReturnValue('/tmp/domain_cache.json'),
        dirname: jest.fn().mockReturnValue('/tmp'),
        join: jest.fn().mockImplementation((...args) => args.join('/')),
    };
});
jest.mock('../../../src/config', () => ({
    TAMILMV_DOMAINS: ['https://main.com', 'https://backup.com'],
}));
jest.mock('../../../src/utils/helpers', () => ({
    ensureFolderExists: jest.fn(),
}));
jest.mock('../../../src/utils/logger');

describe('DomainResolver', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset state
        domainResolver.currentDomain = 'https://main.com';
        domainResolver.checkedDate = null;
        // path mock is already set in factory, but we can override if needed
    });

    describe('resolve', () => {
        it('should return cached domain if recently checked', async () => {
            domainResolver.checkedDate = Date.now();
            const domain = await domainResolver.resolve();
            expect(domain).toBe('https://main.com');
            expect(axios.head).not.toHaveBeenCalled();
        });

        it('should check domains and return working one', async () => {
            axios.head.mockImplementation((url) => {
                if (url === 'https://main.com') return Promise.resolve({ status: 200 });
                return Promise.reject(new Error('Down'));
            });

            fs.existsSync.mockReturnValue(false); // No disk cache

            const domain = await domainResolver.resolve();

            expect(domain).toBe('https://main.com');
            expect(axios.head).toHaveBeenCalledWith('https://main.com', expect.any(Object));
        });

        it('should try backup domain if main fails', async () => {
            axios.head.mockImplementation((url) => {
                if (url === 'https://main.com') return Promise.reject(new Error('Down'));
                if (url === 'https://backup.com') return Promise.resolve({ status: 200 });
                return Promise.reject(new Error('Down'));
            });

            fs.existsSync.mockReturnValue(false);

            const domain = await domainResolver.resolve();

            expect(domain).toBe('https://backup.com');
            expect(axios.head).toHaveBeenCalledTimes(2);
        });

        it('should prioritize learned domain from disk cache', async () => {
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(
                JSON.stringify({
                    workingDomains: ['https://learned.com'],
                    domain: 'https://learned.com',
                })
            );

            axios.head.mockImplementation((url) => {
                if (url === 'https://learned.com') return Promise.resolve({ status: 200 });
                return Promise.reject(new Error('Down'));
            });

            const domain = await domainResolver.resolve();

            expect(domain).toBe('https://learned.com');
            expect(axios.head).toHaveBeenCalledWith('https://learned.com', expect.any(Object));
        });

        it('should throw error if all domains fail', async () => {
            axios.head.mockRejectedValue(new Error('Down'));
            fs.existsSync.mockReturnValue(false);

            await expect(domainResolver.resolve()).rejects.toThrow(
                'All TamilMV domains are unreachable'
            );
        });
    });

    describe('saveCache', () => {
        it('should save working domain to cache', () => {
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(
                JSON.stringify({ workingDomains: ['https://old.com'] })
            );

            domainResolver.saveCache('https://new.com');

            expect(ensureFolderExists).toHaveBeenCalled();
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining('https://new.com')
            );
        });

        it('should handle errors during save', () => {
            ensureFolderExists.mockImplementation(() => {
                throw new Error('Write fail');
            });

            domainResolver.saveCache('https://new.com');

            expect(log.error).toHaveBeenCalled();
        });
    });

    describe('getUrl', () => {
        it('should return full url with current domain', () => {
            domainResolver.currentDomain = 'https://domain.com';
            expect(domainResolver.getUrl('path')).toBe('https://domain.com/path');
            expect(domainResolver.getUrl('/path')).toBe('https://domain.com/path');
        });
    });

    describe('loadCache', () => {
        it('should return null if file not exists', () => {
            fs.existsSync.mockReturnValue(false);
            expect(domainResolver.loadCache()).toBeNull();
        });

        it('should handle read error', () => {
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockImplementation(() => {
                throw new Error('Read fail');
            });
            expect(domainResolver.loadCache()).toBeNull();
            expect(log.debug).toHaveBeenCalled();
        });
    });
});
