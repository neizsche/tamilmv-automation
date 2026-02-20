const fs = require('fs');
const path = require('path');
const { defaultClient } = require('../utils/httpClient');
const config = require('../config');
const { log } = require('../utils/logger');
const { ensureFolderExists } = require('../utils/helpers');

class TorrentDownloader {
    constructor() {
        ensureFolderExists(config.TORRENT_FOLDER);
    }

    async download(torrentLink, fileName) {
        const filePath = path.resolve(config.TORRENT_FOLDER, fileName);

        try {
            const writer = fs.createWriteStream(filePath);
            const response = await defaultClient.get(torrentLink, {
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

    deleteFile(fileName) {
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

    generateFilename() {
        const uniqueSuffix = Math.random().toString(36).substring(2, 8);
        return `${Date.now()}-${uniqueSuffix}.torrent`;
    }
}

module.exports = new TorrentDownloader();
