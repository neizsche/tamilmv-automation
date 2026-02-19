const fs = require('fs');
const path = require('path');
const { createScraperClient } = require('../utils/httpClient');
const { Timeouts } = require('../utils/constants');
const config = require('../config');
const { log } = require('../utils/logger');
const { ensureFolderExists } = require('../utils/helpers');

class TorrentDownloader {
    constructor() {
        ensureFolderExists(config.TORRENT_FOLDER);
        this.httpClient = createScraperClient({ timeout: Timeouts.FILE_DOWNLOAD });
    }

    async download(torrentLink, fileName) {
        const filePath = path.resolve(config.TORRENT_FOLDER, fileName);

        try {
            const writer = fs.createWriteStream(filePath);
            const response = await this.httpClient.get(torrentLink, {
                responseType: 'stream',
            });
            response.data.pipe(writer);

            return new Promise((resolve) => {
                writer.on('finish', () => {
                    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
                        resolve(true);
                    } else {
                        log.warning(`Downloaded file is empty or missing: ${fileName}`);
                        resolve(false);
                    }
                });
                writer.on('error', (err) => {
                    log.warning(`Stream error downloading ${fileName}: ${err.message}`);
                    try {
                        fs.unlinkSync(filePath);
                    } catch {
                        // Ignore error during cleanup
                    }
                    resolve(false);
                });
            });
        } catch (error) {
            log.warning(`Error downloading file from ${torrentLink}: ${error.message}`);
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch {
                // Ignore error during cleanup
            }
            return false;
        }
    }

    delete(fileName) {
        const filePath = path.resolve(config.TORRENT_FOLDER, fileName);

        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                return true;
            }
            return false;
        } catch (error) {
            log.warning(`Error deleting file: ${filePath}`, error.message);
            return false;
        }
    }

    cleanupOrphaned() {
        try {
            const files = fs.readdirSync(config.TORRENT_FOLDER);
            const torrentFiles = files.filter((f) => f.endsWith('.torrent'));

            if (torrentFiles.length > 0) {
                log.info(`Cleaning up ${torrentFiles.length} orphaned torrent files`);
                torrentFiles.forEach((file) => {
                    this.delete(file);
                });
            }

            return torrentFiles.length;
        } catch (error) {
            log.warning('Error cleaning up old torrent files', error.message);
            return 0;
        }
    }

    generateFilename() {
        const uniqueSuffix = Math.random().toString(36).substring(2, 8);
        return `${Date.now()}-${uniqueSuffix}.torrent`;
    }
}

module.exports = new TorrentDownloader();
