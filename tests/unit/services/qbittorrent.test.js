const qbittorrent = require('../../../src/services/qbittorrent');
const axios = require('axios');
const fs = require('fs');
const config = require('../../../src/config');
const csvLogger = require('../../../src/utils/csvLogger');
const { log } = require('../../../src/utils/logger');

jest.mock('axios');
jest.mock('fs');
jest.mock('form-data', () => {
    return jest.fn().mockImplementation(() => ({
        append: jest.fn(),
        getHeaders: jest.fn().mockReturnValue({
            'content-type': 'multipart/form-data; boundary=----test',
        }),
    }));
});
jest.mock('../../../src/config', () => ({
    LOGIN_URL: 'http://qbit/login',
    TORRENT_URL: 'http://qbit/torrents',
    USERNAME: 'tuser',
    PASSWORD: 'tpass',
    QBITTORRENT: {
        TAG: 'automation_tag',
        CATEGORY_ACTIVE: 'active',
        CATEGORY_COMPLETED: 'completed',
    },
}));
jest.mock('../../../src/utils/csvLogger');
jest.mock('../../../src/utils/logger', () => ({
    log: {
        info: jest.fn(),
        success: jest.fn(),
        warning: jest.fn(),
        debug: jest.fn(),
        error: jest.fn(),
    },
    displayProgressBar: jest.fn(),
}));

// Mock FormData?
// axios post calls receive a FormData instance.
// We can check if the second arg is instance of FormData or just check headers.

describe('QBittorrentClient', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        qbittorrent.sid = null;
    });

    describe('login', () => {
        it('should login and set SID', async () => {
            axios.post.mockResolvedValue({
                headers: { 'set-cookie': ['SID=12345; path=/'] },
            });

            const sid = await qbittorrent.login();

            expect(sid).toBe('12345');
            expect(qbittorrent.sid).toBe('12345');
            expect(axios.post).toHaveBeenCalledWith(
                'http://qbit/login',
                expect.stringContaining('username=tuser'),
                expect.any(Object)
            );
        });

        it('should throw error if no SID received', async () => {
            axios.post.mockResolvedValue({ headers: { 'set-cookie': [] } });

            await expect(qbittorrent.login()).rejects.toThrow('No SID received');
        });

        it('should handle login error', async () => {
            axios.post.mockRejectedValue(new Error('Login fail'));
            await expect(qbittorrent.login()).rejects.toThrow('Login fail');
        });
    });

    describe('addTorrent', () => {
        it('should add torrent successfully', async () => {
            qbittorrent.sid = 'existing_sid';
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue('file_content');
            axios.post.mockResolvedValue({ status: 200 });

            const result = await qbittorrent.addTorrent('file.torrent');

            expect(result).toBe(true);
            expect(axios.post).toHaveBeenCalledWith(
                'http://qbit/torrents/add',
                expect.any(Object), // FormData
                expect.objectContaining({
                    headers: expect.objectContaining({ Cookie: 'SID=existing_sid' }),
                })
            );
        });

        it('should retry login on 403', async () => {
            qbittorrent.sid = 'expired_sid';
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue('file_content');

            // Mock axios.post to return different values in sequence
            axios.post
                .mockRejectedValueOnce({ response: { status: 403 } }) // First /add fails with 403
                .mockResolvedValueOnce({ headers: { 'set-cookie': ['SID=new_sid; path=/'] } }) // /login succeeds
                .mockResolvedValueOnce({ status: 200 }); // Second /add succeeds

            const result = await qbittorrent.addTorrent('file.torrent');

            expect(result).toBe(true);
            expect(qbittorrent.sid).toBe('new_sid');
            expect(axios.post).toHaveBeenCalledTimes(3);
        });

        it('should return false if file not found', async () => {
            qbittorrent.sid = 'sid';
            fs.existsSync.mockReturnValue(false);

            const result = await qbittorrent.addTorrent('file.torrent');

            expect(result).toBe(false);
            expect(axios.post).not.toHaveBeenCalled();
        });

        it('should return false if re-authentication fails after 403', async () => {
            qbittorrent.sid = 'expired_sid';
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue('file_content');

            // First /add fails with 403, then login fails, then retry /add also fails
            axios.post
                .mockRejectedValueOnce({ response: { status: 403 } })
                .mockRejectedValueOnce(new Error('Login failed'));

            const result = await qbittorrent.addTorrent('file.torrent');

            expect(result).toBe(false);
        });

        it('should return false on non-403 error', async () => {
            qbittorrent.sid = 'sid';
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue('file_content');

            axios.post.mockRejectedValueOnce({ response: { status: 500 } });

            const result = await qbittorrent.addTorrent('file.torrent');

            expect(result).toBe(false);
        });
    });

    describe('ensureAuthenticated', () => {
        it('should call login if sid is not set', async () => {
            qbittorrent.sid = null;
            axios.post.mockResolvedValue({ headers: { 'set-cookie': ['SID=new_sid; path=/'] } });

            await qbittorrent.ensureAuthenticated();

            expect(qbittorrent.sid).toBe('new_sid');
            expect(axios.post).toHaveBeenCalled();
        });

        it('should not call login if sid is already set', async () => {
            qbittorrent.sid = 'existing_sid';

            const sid = await qbittorrent.ensureAuthenticated();

            expect(sid).toBe('existing_sid');
            expect(axios.post).not.toHaveBeenCalled();
        });
    });

    describe('getTorrents', () => {
        it('should get torrents', async () => {
            qbittorrent.sid = 'sid';
            const torrents = [{ name: 't1' }];
            axios.get.mockResolvedValue({ data: torrents });

            const result = await qbittorrent.getTorrents();

            expect(result).toEqual(torrents);
            expect(axios.get).toHaveBeenCalledWith(
                'http://qbit/torrents/info',
                expect.objectContaining({ headers: { Cookie: 'SID=sid' } })
            );
        });

        it('should filter torrents if requested', async () => {
            qbittorrent.sid = 'sid';
            const torrents = [
                {
                    name: 't1',
                    progress: 0,
                    state: 'stoppedDL',
                    tags: 'automation_tag',
                    category: 'active',
                },
                {
                    name: 't2',
                    progress: 1,
                    state: 'uploading',
                    tags: 'automation_tag',
                    category: 'active',
                },
            ];
            axios.get.mockResolvedValue({ data: torrents });

            const result = await qbittorrent.getTorrents(true);

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('t1');
        });
    });

    describe('manageTorrents', () => {
        it('should delete torrents', async () => {
            qbittorrent.sid = 'sid';
            const torrents = [{ hash: 'h1', name: 't1' }];
            axios.post.mockResolvedValue({ status: 200 });

            await qbittorrent.manageTorrents(torrents, 'delete');

            expect(axios.post).toHaveBeenCalledWith(
                'http://qbit/torrents/delete',
                expect.any(Object),
                expect.any(Object)
            );
            expect(csvLogger.logRemoved).toHaveBeenCalled();
        });

        it('should re-auth on 403 during manage', async () => {
            qbittorrent.sid = 'expired';
            const torrents = [{ hash: 'h1', name: 't1' }];

            axios.post
                .mockRejectedValueOnce({ response: { status: 403 } })
                .mockResolvedValueOnce({ headers: { 'set-cookie': ['SID=new;'] } })
                .mockResolvedValueOnce({ status: 200 });

            await qbittorrent.manageTorrents(torrents, 'delete');

            expect(axios.post).toHaveBeenCalledTimes(3);
        });
    });

    // Testing cleanup methods indirectly through public cleanupCompletedTorrents
    // or we can test them if we want to be thorough but they are internal.
    // They call _processTorrentBatch which calls manageTorrents.

    describe('cleanupCompletedTorrents', () => {
        it('should cleanup stopped, stalled, and fully downloaded torrents', async () => {
            qbittorrent.sid = 'sid';
            const torrents = [
                { hash: 'h1', name: 't1', tags: 'automation_tag', progress: 1, state: 'uploading' }, // Should stop
                {
                    hash: 'h2',
                    name: 't2',
                    tags: 'automation_tag',
                    state: 'stalledDL',
                    category: 'active',
                }, // Should delete
            ];

            axios.get.mockResolvedValue({ data: torrents });
            axios.post.mockResolvedValue({ status: 200 });

            await qbittorrent.cleanupCompletedTorrents();

            expect(axios.post).toHaveBeenCalledWith(
                'http://qbit/torrents/stop',
                expect.any(Object),
                expect.any(Object)
            );
            expect(axios.post).toHaveBeenCalledWith(
                'http://qbit/torrents/delete',
                expect.any(Object),
                expect.any(Object)
            );
        });

        it('should handle errors during cleanup gracefully', async () => {
            qbittorrent.sid = 'sid';
            axios.get.mockRejectedValue(new Error('Network error'));

            // Should not throw
            await expect(qbittorrent.cleanupCompletedTorrents()).resolves.not.toThrow();
        });

        it('should delete torrents in completed category', async () => {
            qbittorrent.sid = 'sid';
            const torrents = [
                { hash: 'h1', name: 't1', tags: 'automation_tag', category: 'completed' },
            ];

            axios.get.mockResolvedValue({ data: torrents });
            axios.post.mockResolvedValue({ status: 200 });

            await qbittorrent._deleteCompletedTorrents(torrents);

            expect(axios.post).toHaveBeenCalledWith(
                'http://qbit/torrents/delete',
                expect.any(Object),
                expect.any(Object)
            );
        });

        it('should delete all stopped torrents with tag', async () => {
            qbittorrent.sid = 'sid';
            const torrents = [
                { hash: 'h1', name: 't1', tags: 'automation_tag', state: 'stoppedDL' },
                { hash: 'h2', name: 't2', tags: 'automation_tag', state: 'stoppedUP' },
            ];

            axios.get.mockResolvedValue({ data: torrents });
            axios.post.mockResolvedValue({ status: 200 });

            await qbittorrent._deleteStoppedTorrents(torrents);

            expect(axios.post).toHaveBeenCalledWith(
                'http://qbit/torrents/delete',
                expect.any(Object),
                expect.any(Object)
            );
        });
    });
});
