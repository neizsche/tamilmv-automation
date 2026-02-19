const csvLogger = require('../../../src/utils/csvLogger');
const fs = require('fs');
const path = require('path');
const { parseMovieName } = require('../../../src/utils/helpers');

jest.mock('fs');
jest.mock('path');
jest.mock('../../../src/utils/helpers', () => ({
    parseMovieName: jest.fn((name) => ({ display: name.toUpperCase() })),
}));

describe('CSVLogger', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        path.join.mockReturnValue('/tmp/torrent_events.csv');
        path.dirname.mockReturnValue('/tmp');
        csvLogger.csvPath = '/tmp/torrent_events.csv';
    });

    describe('ensureCSVExists', () => {
        it('should create directory and file if not exists', () => {
            fs.existsSync.mockReturnValue(false);

            csvLogger.ensureCSVExists();

            expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp', { recursive: true });
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                '/tmp/torrent_events.csv',
                expect.stringContaining('Movie Name'),
                'utf8'
            );
        });

        it('should not create if exists', () => {
            fs.existsSync.mockReturnValue(true);
            csvLogger.ensureCSVExists();
            expect(fs.mkdirSync).not.toHaveBeenCalled();
            expect(fs.writeFileSync).not.toHaveBeenCalled();
        });
    });

    describe('logAdded', () => {
        it('should append row to CSV', () => {
            csvLogger.logAdded('Movie Name', 1024 ** 3);

            expect(fs.appendFileSync).toHaveBeenCalledWith(
                '/tmp/torrent_events.csv',
                expect.stringContaining('MOVIE NAME,1.00,'),
                'utf8'
            );
        });

        it('should handle errors', () => {
            fs.appendFileSync.mockImplementation(() => {
                throw new Error('Write error');
            });
            // Should not throw
            expect(() => csvLogger.logAdded('Movie', 100)).not.toThrow();
        });
    });

    describe('logRemoved', () => {
        it('should update removed time and duration', () => {
            const addedTime = new Date(Date.now() - 3600000)
                .toISOString()
                .replace('T', ' ')
                .substring(0, 19);
            const csvContent = `Header\nMOVIE NAME,1.00,${addedTime},,`;

            fs.readFileSync.mockReturnValue(csvContent);

            csvLogger.logRemoved('Movie Name');

            expect(fs.writeFileSync).toHaveBeenCalledWith(
                '/tmp/torrent_events.csv',
                expect.stringMatching(/1\.00$/m), // Duration should be around 1.00
                'utf8'
            );
        });

        it('should not update if movie not found or already removed', () => {
            const csvContent = `Header\nOTHER MOVIE,1.00,time,,`;
            fs.readFileSync.mockReturnValue(csvContent);

            csvLogger.logRemoved('Movie Name');

            expect(fs.writeFileSync).not.toHaveBeenCalled();
        });

        it('should handle errors during read', () => {
            fs.readFileSync.mockImplementation(() => {
                throw new Error('Read error');
            });
            expect(() => csvLogger.logRemoved('Movie')).not.toThrow();
        });
    });

    describe('special characters', () => {
        it('should escape commas in movie names', () => {
            csvLogger.logAdded('Movie, The Sequel', 2 * 1024 ** 3);

            expect(fs.appendFileSync).toHaveBeenCalledWith(
                '/tmp/torrent_events.csv',
                expect.stringContaining('"MOVIE, THE SEQUEL"'),
                'utf8'
            );
        });

        it('should escape quotes in movie names', () => {
            csvLogger.logAdded('Movie "Special" Edition', 2 * 1024 ** 3);

            expect(fs.appendFileSync).toHaveBeenCalledWith(
                '/tmp/torrent_events.csv',
                expect.stringContaining('MOVIE ""SPECIAL"" EDITION'),
                'utf8'
            );
        });
    });
});
