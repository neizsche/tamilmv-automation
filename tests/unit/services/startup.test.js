const { validateSetup } = require('../../../src/services/startup');

const axios = require('axios');
const qbittorrent = require('../../../src/services/qbittorrent');
const domainResolver = require('../../../src/services/domainResolver');

// Mock dependencies
jest.mock('axios');
jest.mock('../../../src/services/qbittorrent');
jest.mock('../../../src/services/domainResolver');
jest.mock('../../../src/utils/logger', () => ({
    log: {
        info: jest.fn(),
        error: jest.fn(),
    },
}));
jest.mock('../../../src/config', () => ({
    RADARR_URL: 'http://radarr',
    RADARR_API_KEY: 'apikey',
    QBITTORRENT_URL: 'http://qbit',
    TAMILMV_DOMAINS: ['https://1tamilmv.cz'],
}));

describe('Startup Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should resolve domain, connect to qBittorrent, and connect to Radarr on success', async () => {
        domainResolver.resolve.mockResolvedValue('https://1tamilmv.cz');
        qbittorrent.login.mockResolvedValue(true);
        axios.get.mockResolvedValue({ status: 200 });

        await expect(validateSetup(false, 2)).resolves.not.toThrow();

        expect(domainResolver.resolve).toHaveBeenCalled();
        expect(qbittorrent.login).toHaveBeenCalled();
        expect(axios.get).toHaveBeenCalledWith(
            'http://radarr/api/v3/system/status',
            expect.objectContaining({ headers: { 'X-Api-Key': 'apikey' } })
        );
    });

    it('should throw error if domain resolution fails', async () => {
        domainResolver.resolve.mockRejectedValue(new Error('Domain fail'));

        await expect(validateSetup(false, 2)).rejects.toThrow('Domain fail');
    });

    it('should throw error if qBittorrent login fails', async () => {
        domainResolver.resolve.mockResolvedValue('https://1tamilmv.cz');
        qbittorrent.login.mockRejectedValue(new Error('Auth fail'));

        await expect(validateSetup(false, 2)).rejects.toThrow('Auth fail');
    });

    it('should throw error if Radarr connection fails', async () => {
        domainResolver.resolve.mockResolvedValue('https://1tamilmv.cz');
        qbittorrent.login.mockResolvedValue(true);
        axios.get.mockRejectedValue(new Error('Radarr down'));

        await expect(validateSetup(false, 2)).rejects.toThrow('Radarr down');
    });
});
