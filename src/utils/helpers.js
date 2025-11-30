import { existsSync, mkdirSync } from 'fs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureFolderExists = (folderPath) => {
  if (!existsSync(folderPath)) {
    mkdirSync(folderPath, { recursive: true });
  }
};

const extractMovieName = (torrentName) => {
  const match = torrentName.match(/www\.1TamilMV\.pink\s*-\s*([^(]+\(\d{4}\))/i);
  return match ? match[1].trim().toUpperCase() : torrentName;
};

const formatTorrentTitle = (url) => {
  const regex = /forums\/topic\/\d+-(.+?)-(?:malayalam|tamil|hindi|telugu|kannada)/i;
  const match = url.match(regex);
  return match ? match[1] : url;
};

export default {
  wait,
  ensureFolderExists,
  extractMovieName,
  formatTorrentTitle,
};
