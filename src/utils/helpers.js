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
    parseMovieName,
};
