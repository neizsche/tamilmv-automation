const downloader = require('../../../src/processors/downloader');
const fs = require('fs');
const path = require('path');
const config = require('../../../src/config');
const { createScraperClient } = require('../../../src/utils/httpClient');
const { log } = require('../../../src/utils/logger');

// Mock dependencies
jest.mock('fs');
jest.mock('path');
jest.mock('../../../src/config', () => ({
    TORRENT_FOLDER: '/tmp/torrents',
}));
jest.mock('../../../src/utils/httpClient');
jest.mock('../../../src/utils/logger');
jest.mock('../../../src/utils/helpers', () => ({
    ensureFolderExists: jest.fn(),
}));

describe('TorrentDownloader', () => {
    let mockHttpClient;
    let mockWriter;

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock path.resolve
        path.resolve.mockImplementation((...args) => args.join('/'));
        path.basename.mockImplementation((p) => p.split('/').pop());

        // Mock HTTP Client
        mockHttpClient = {
            get: jest.fn(),
        };
        createScraperClient.mockReturnValue(mockHttpClient);
        // We need to re-instantiate or access the instance's client if it was created in constructor
        // Since module exports 'new TorrentDownloader()', the constructor ran already.
        // We might need to manually inject the mock or rely on jest.mock hoisting if constructor uses imported createScraperClient?
        // But constructor runs at require time.
        // To properly test, we should probably modify the downloader instance to use our mock client
        downloader.httpClient = mockHttpClient;

        // Mock Stream
        mockWriter = {
            on: jest.fn(),
            write: jest.fn(),
            end: jest.fn(),
        };
        fs.createWriteStream.mockReturnValue(mockWriter);
    });

    describe('download', () => {
        it('should download file successfully', async () => {
            const mockStream = {
                pipe: jest.fn(),
            };
            mockHttpClient.get.mockResolvedValue({ data: mockStream });
            fs.existsSync.mockReturnValue(true);
            fs.statSync.mockReturnValue({ size: 1024 });

            const promise = downloader.download('http://example.com/file.torrent', 'file.torrent');

            // Allow async function to proceed to where listeners are attached
            await new Promise((resolve) => setTimeout(resolve, 0));

            // Simulate stream finish
            const finishCallback = mockWriter.on.mock.calls.find((call) => call[0] === 'finish')[1];
            finishCallback();

            await expect(promise).resolves.toBe(true);
            expect(mockHttpClient.get).toHaveBeenCalledWith('http://example.com/file.torrent', {
                responseType: 'stream',
            });
            expect(mockStream.pipe).toHaveBeenCalledWith(mockWriter);
        });

        it('should handle download failure (empty file)', async () => {
            const mockStream = {
                pipe: jest.fn(),
            };
            mockHttpClient.get.mockResolvedValue({ data: mockStream });
            fs.existsSync.mockReturnValue(true);
            fs.statSync.mockReturnValue({ size: 0 }); // Empty file

            const promise = downloader.download('http://example.com/file.torrent', 'file.torrent');

            await new Promise((resolve) => setTimeout(resolve, 0));

            const finishCallback = mockWriter.on.mock.calls.find((call) => call[0] === 'finish')[1];
            finishCallback();

            await expect(promise).resolves.toBe(false);
            expect(log.warning).toHaveBeenCalledWith(
                expect.stringContaining('Downloaded file is empty')
            );
        });

        it('should handle stream error', async () => {
            const mockStream = {
                pipe: jest.fn(),
            };
            mockHttpClient.get.mockResolvedValue({ data: mockStream });

            const promise = downloader.download('http://example.com/file.torrent', 'file.torrent');

            await new Promise((resolve) => setTimeout(resolve, 0));

            const errorCallback = mockWriter.on.mock.calls.find((call) => call[0] === 'error')[1];
            errorCallback(new Error('Stream error'));

            await expect(promise).resolves.toBe(false);
            expect(log.warning).toHaveBeenCalledWith(expect.stringContaining('Stream error'));
            expect(fs.unlinkSync).toHaveBeenCalled();
        });

        it('should handle http error', async () => {
            mockHttpClient.get.mockRejectedValue(new Error('Network error'));

            await expect(
                downloader.download('http://example.com/file.torrent', 'file.torrent')
            ).resolves.toBe(false);
            expect(log.warning).toHaveBeenCalledWith(
                expect.stringContaining('Error downloading file')
            );
        });
    });

    describe('delete', () => {
        it('should delete existing file', () => {
            fs.existsSync.mockReturnValue(true);

            const result = downloader.delete('file.torrent');

            expect(result).toBe(true);
            expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('file.torrent'));
        });

        it('should return false if file does not exist', () => {
            fs.existsSync.mockReturnValue(false);

            const result = downloader.delete('file.torrent');

            expect(result).toBe(false);
            expect(fs.unlinkSync).not.toHaveBeenCalled();
        });

        it('should handle delete error', () => {
            fs.existsSync.mockReturnValue(true);
            fs.unlinkSync.mockImplementation(() => {
                throw new Error('Permission denied');
            });

            const result = downloader.delete('file.torrent');

            expect(result).toBe(false);
            expect(log.warning).toHaveBeenCalledWith(
                expect.stringContaining('Error deleting file'),
                expect.any(String)
            );
        });
    });

    describe('cleanupOrphaned', () => {
        it('should cleanup torrent files', () => {
            fs.readdirSync.mockReturnValue(['file1.torrent', 'file2.txt']);
            fs.existsSync.mockReturnValue(true); // For delete

            const count = downloader.cleanupOrphaned();

            expect(count).toBe(1); // Only .torrent file
            expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
        });

        it('should handle errors during cleanup', () => {
            fs.readdirSync.mockImplementation(() => {
                throw new Error('Read error');
            });

            const count = downloader.cleanupOrphaned();

            expect(count).toBe(0);
            expect(log.warning).toHaveBeenCalledWith(
                expect.stringContaining('Error cleaning up'),
                expect.any(String)
            );
        });
    });
});
