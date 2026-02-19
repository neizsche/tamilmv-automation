const filter = require('../../../src/processors/filter');
const qbittorrent = require('../../../src/services/qbittorrent');
const { parseMovieName } = require('../../../src/utils/helpers');

jest.mock('../../../src/config', () => ({
    TORRENT_SIZE: {
        MIN_GB: 1,
        MAX_GB: 3,
    },
    QBITTORRENT: {
        TAG: 'automation_tag',
        CATEGORY_ACTIVE: 'active',
    },
}));

jest.mock('../../../src/services/qbittorrent', () => ({
    manageTorrents: jest.fn().mockResolvedValue(true),
    getTorrents: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../src/utils/logger', () => ({
    log: {
        debug: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
    },
}));

jest.mock('../../../src/utils/helpers', () => ({
    parseMovieName: jest.requireActual('../../../src/utils/helpers').parseMovieName,
}));

describe('TorrentFilter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('bySize', () => {
        it('should keep torrents within size range', async () => {
            const torrents = [
                { name: 'Valid Movie', size: 1.5 * 1024 ** 3 }, // 1.5 GB
                { name: 'Another Valid', size: 2.5 * 1024 ** 3 }, // 2.5 GB
            ];

            const result = await filter.bySize(torrents);

            expect(result.filtered).toHaveLength(2);
            expect(result.removed).toHaveLength(0);
        });

        it('should remove torrents that are too small', async () => {
            const torrents = [
                { name: 'Small Movie', size: 0.5 * 1024 ** 3 }, // 0.5 GB
            ];

            const result = await filter.bySize(torrents);

            expect(result.filtered).toHaveLength(0);
            expect(result.removed).toHaveLength(1);
            expect(result.countSmall).toBe(1);
        });

        it('should remove torrents that are too large', async () => {
            const torrents = [
                { name: 'Large Movie', size: 5 * 1024 ** 3 }, // 5 GB
            ];

            const result = await filter.bySize(torrents);

            expect(result.filtered).toHaveLength(0);
            expect(result.removed).toHaveLength(1);
            expect(result.countLarge).toBe(1);
        });

        it('should call qbittorrent.manageTorrents to delete removed torrents', async () => {
            const torrents = [{ name: 'Small Movie', size: 0.5 * 1024 ** 3 }];

            await filter.bySize(torrents);

            expect(qbittorrent.manageTorrents).toHaveBeenCalledWith(
                expect.any(Array),
                'delete',
                'inappropriate size'
            );
        });
    });

    describe('removeDuplicates', () => {
        it('should remove duplicates within the incoming batch, keeping larger/better one', async () => {
            const torrents = [
                {
                    name: 'Movie (2024) 720p',
                    size: 1 * 1024 ** 3,
                    hash: 'h1',
                    tags: 'automation_tag',
                    category: 'active',
                    progress: 0,
                },
                {
                    name: 'Movie (2024) 1080p',
                    size: 2 * 1024 ** 3,
                    hash: 'h2',
                    tags: 'automation_tag',
                    category: 'active',
                    progress: 0,
                },
            ];

            qbittorrent.getTorrents.mockResolvedValue([]); // No existing torrents

            const result = await filter.removeDuplicates(torrents);

            expect(result.filtered).toHaveLength(1);
            expect(result.filtered[0].hash).toBe('h2'); // Larger one kept
            expect(result.removed).toHaveLength(1);
            expect(result.removed[0].hash).toBe('h1');
        });

        it('should remove duplicates that already exist in qBittorrent', async () => {
            const existing = [
                {
                    name: 'Existing Movie (2024)',
                    hash: 'existing_hash',
                    tags: 'automation_tag',
                    category: 'active',
                },
            ];
            qbittorrent.getTorrents.mockResolvedValue(existing);

            const torrents = [
                {
                    name: 'Existing Movie (2024) Repack',
                    hash: 'new_hash',
                    tags: 'automation_tag',
                    category: 'active',
                },
            ];

            const result = await filter.removeDuplicates(torrents);

            expect(result.filtered).toHaveLength(0);
            expect(result.removed).toHaveLength(1);
            expect(result.removed[0].hash).toBe('new_hash');
        });

        it('should prefer higher progress torrent if duplicating', async () => {
            const torrents = [
                {
                    name: 'Movie (2024) 720p',
                    size: 2 * 1024 ** 3,
                    hash: 'h1',
                    tags: 'automation_tag',
                    category: 'active',
                    progress: 0.5,
                },
                {
                    name: 'Movie (2024) 1080p',
                    size: 2 * 1024 ** 3,
                    hash: 'h2',
                    tags: 'automation_tag',
                    category: 'active',
                    progress: 0.8,
                },
            ];

            qbittorrent.getTorrents.mockResolvedValue([]);

            const result = await filter.removeDuplicates(torrents);

            expect(result.filtered).toHaveLength(1);
            expect(result.filtered[0].hash).toBe('h2'); // Higher progress kept
        });

        it('should prefer null to first torrent when both have zero progress', async () => {
            const torrents = [
                {
                    name: 'Movie (2024) Version1',
                    size: 1 * 1024 ** 3,
                    hash: 'h1',
                    tags: 'automation_tag',
                    category: 'active',
                    progress: 0,
                },
                {
                    name: 'Movie (2024) Version2',
                    size: 2 * 1024 ** 3,
                    hash: 'h2',
                    tags: 'automation_tag',
                    category: 'active',
                    progress: 0,
                },
            ];

            qbittorrent.getTorrents.mockResolvedValue([]);

            const result = await filter.removeDuplicates(torrents);

            expect(result.filtered).toHaveLength(1);
            // Should keep larger one since both have 0 progress
            expect(result.filtered[0].hash).toBe('h2');
        });

        it('should call qbittorrent.manageTorrents to delete duplicates', async () => {
            const torrents = [
                {
                    name: 'Movie (2024)',
                    size: 1,
                    hash: 'h1',
                    tags: 'automation_tag',
                    category: 'active',
                },
                {
                    name: 'Movie (2024)',
                    size: 2,
                    hash: 'h2',
                    tags: 'automation_tag',
                    category: 'active',
                },
            ];
            qbittorrent.getTorrents.mockResolvedValue([]);

            await filter.removeDuplicates(torrents);

            expect(qbittorrent.manageTorrents).toHaveBeenCalledWith(
                expect.any(Array),
                'delete',
                'duplicate torrent'
            );
        });
    });

    describe('filterTorrents', () => {
        it('should apply both size and duplicate filters', async () => {
            const torrents = [
                { name: 'Small (2024)', size: 0.1, hash: 'h1' }, // Too small
                {
                    name: 'Duplicate (2024) 1',
                    size: 1.5 * 1024 ** 3,
                    hash: 'h2',
                    tags: 'automation_tag',
                    category: 'active',
                    progress: 0,
                },
                {
                    name: 'Duplicate (2024) 2',
                    size: 2.0 * 1024 ** 3,
                    hash: 'h3',
                    tags: 'automation_tag',
                    category: 'active',
                    progress: 0,
                },
            ];

            qbittorrent.getTorrents.mockResolvedValue([]);

            const result = await filter.filterTorrents(torrents);

            expect(result.remaining.length).toBe(1);
            expect(result.remaining[0].hash).toBe('h3'); // Larger dup kept
            expect(result.summary.totalRemoved).toBe(2);
        });
    });
});
