const fs = require('fs');

const { log } = require('./logger');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureFolderExists = (folderPath) => {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }
};

const extractMovieName = (torrentName) => {
    // 1. Try to match branded pattern: www.1TamilMV.[any] - [Movie Name] (Year)
    const brandedMatch = torrentName.match(/www\.1TamilMV\.[a-z]+\s*-\s*([^(]+\(\d{4}\))/i);
    if (brandedMatch) {
        return brandedMatch[1].trim().toUpperCase();
    }

    // 2. Fallback: Match any pattern that looks like "Movie Name (Year)" at the start
    // This handles: "Movie Name (2024) ..."
    const genericMatch = torrentName.match(/^([^(]+\(\d{4}\))/i);
    if (genericMatch) {
        return genericMatch[1].trim().toUpperCase();
    }

    // 3. Last resort: return original name
    return torrentName;
};

const formatTorrentTitle = (url) => {
    const regex = /forums\/topic\/\d+-(.+?)-(?:malayalam|tamil|hindi|telugu|kannada)/i;
    const match = url.match(regex);
    return match ? match[1] : url;
};

// Retry utility with exponential backoff
const retryWithBackoff = async (
    fn,
    maxRetries = 3,
    initialDelayMs = 1000,
    operationName = 'operation'
) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries) {
                // Last attempt failed, throw the error
                throw error;
            }

            const delay = initialDelayMs * Math.pow(2, attempt - 1); // Exponential backoff
            log.warning(
                `${operationName} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`
            );
            await wait(delay);
        }
    }
};

// Extract and parse movie information from torrent name
function parseMovieName(torrentName) {
    const nameBeforeYear = torrentName.split(/\(\d{4}\)/)[0].trim();
    const movieName = nameBeforeYear.split('- ')[1]?.toUpperCase() || nameBeforeYear.toUpperCase();
    const year = torrentName.match(/\((\d{4})\)/)?.[1] || '';
    const cleanName = nameBeforeYear.split('- ')[1] || nameBeforeYear;

    return {
        display: movieName, // "MOVIE NAME" for display/logging
        year: year, // "2024"
        clean: cleanName, // "Movie Name" (original case)
        original: torrentName, // Full original name
    };
}

module.exports = {
    wait,
    ensureFolderExists,
    extractMovieName,
    formatTorrentTitle,
    retryWithBackoff,
    parseMovieName,
};
