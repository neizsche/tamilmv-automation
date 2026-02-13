const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const config = require("../config");
const { log } = require("../utils/logger");
const { parseMovieName } = require("../utils/helpers");
const csvLogger = require("../utils/csvLogger");

class QBittorrentClient {
  constructor() {
    this.sid = null;
  }

  async login() {
    try {
      const response = await axios.post(
        config.LOGIN_URL,
        `username=${config.USERNAME}&password=${config.PASSWORD}`,
        {
          headers: {
            accept: "text/plain",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          maxRedirects: 0,
        }
      );

      const cookies = response.headers["set-cookie"];
      const sid = cookies?.find(cookie => cookie.startsWith("SID="))?.split("=")[1]?.split(";")[0];

      if (!sid) throw new Error("No SID received");

      this.sid = sid;
      return sid;
    } catch (error) {
      log.error("QBittorrent login failed", error);
      throw error;
    }
  }

  async ensureAuthenticated() {
    if (!this.sid) {
      await this.login();
    }
    return this.sid;
  }

  async addTorrent(torrentFile) {
    const sid = await this.ensureAuthenticated();
    const form = new FormData();

    // Check if file exists before trying to read it
    if (!fs.existsSync(torrentFile)) {
      log.error(`Torrent file not found: ${torrentFile}`);
      return false;
    }

    // Use readFileSync instead of createReadStream to avoid open file handles
    // This ensures the file can be deleted immediately after upload
    form.append("torrents", fs.readFileSync(torrentFile), {
      filename: path.basename(torrentFile),
      contentType: 'application/x-bittorrent'
    });
    form.append("stopped", "true");
    form.append("category", config.QBITTORRENT.CATEGORY_ACTIVE);
    form.append("tags", config.QBITTORRENT.TAG);

    try {
      await axios.post(`${config.TORRENT_URL}/add`, form, {
        headers: {
          ...form.getHeaders(),
          "User-Agent": "Fiddler",
          Cookie: `SID=${sid}`,
        },
        timeout: 10000
      });
      return true;
    } catch (error) {
      // If 403, session likely expired - try re-authenticating once
      if (error.response?.status === 403) {
        log.warning('QBittorrent session expired, re-authenticating...');
        this.sid = null;

        try {
          const newSid = await this.login();
          // Note: form data can be reused since we used readFileSync
          await axios.post(`${config.TORRENT_URL}/add`, form, {
            headers: {
              ...form.getHeaders(),
              "User-Agent": "Fiddler",
              Cookie: `SID=${newSid}`,
            },
            timeout: 10000
          });
          log.success('Re-authentication successful, torrent added');
          return true;
        } catch (retryError) {
          log.error("Failed to add torrent after re-authentication", retryError);
          return false;
        }
      }

      log.error("Failed to add torrent", error);
      return false;
    }
  }

  async getTorrents(applyFilter = false) {
    const sid = await this.ensureAuthenticated();

    try {
      const { data } = await axios.get(`${config.TORRENT_URL}/info`, {
        headers: { Cookie: `SID=${sid}` },
      });

      if (applyFilter) {
        return data.filter(torrent =>
          torrent.progress === 0 &&
          torrent.state === "stoppedDL" &&
          torrent.tags === config.QBITTORRENT.TAG &&
          torrent.category === config.QBITTORRENT.CATEGORY_ACTIVE
        );
      }
      return data;
    } catch (error) {
      log.error("Failed to get torrents", error);
      return [];
    }
  }

  async manageTorrents(torrents, action, reason = "") {
    if (torrents.length === 0) return;

    const sid = await this.ensureAuthenticated();

    for (const torrent of torrents) {
      const form = new FormData();
      form.append("hashes", torrent.hash);

      if (action === "delete") {
        form.append("deleteFiles", "true");
        // Log removal to CSV before deleting
        csvLogger.logRemoved(torrent.name, torrent.size);
      }

      try {
        await axios.post(`${config.TORRENT_URL}/${action}`, form, {
          headers: {
            ...form.getHeaders(),
            Cookie: `SID=${sid}`,
          },
          timeout: 10000
        });

      } catch (error) {
        // If 403, try re-authenticating once
        if (error.response?.status === 403) {
          log.warning(`Session expired for ${action} operation, re-authenticating...`);
          this.sid = null;
          try {
            const newSid = await this.login();
            await axios.post(`${config.TORRENT_URL}/${action}`, form, {
              headers: {
                ...form.getHeaders(),
                Cookie: `SID=${newSid}`,
              },
              timeout: 10000
            });
            log.success(`Re-authenticated and ${action} successful for: ${torrent.name}`);
          } catch (retryError) {
            log.error(`Failed to ${action} torrent after re-auth: ${torrent.name}`, retryError);
          }
        } else {
          // Log more details about the error
          const errorDetails = error.response?.data || error.message;
          log.error(`Failed to ${action} torrent: ${torrent.name}`, errorDetails);
        }
      }
    }
  }

  // Helper: Log torrent information
  _logTorrentInfo(torrent, prefix, logLevel = "info") {
    const parsed = parseMovieName(torrent.name);
    const sizeGB = (torrent.size / 1024 ** 3).toFixed(2);
    const message = `${prefix} ${parsed.display} (${sizeGB} GB)`;

    if (logLevel === "warning") {
      log.warning(message);
    } else {
      log.info(message);
    }
  }

  // Helper: Process and manage a batch of torrents
  async _processTorrentBatch(torrents, action, logPrefix, logLevel = "info") {
    if (torrents.length === 0) return;

    for (const torrent of torrents) {
      this._logTorrentInfo(torrent, logPrefix, logLevel);
    }

    await this.manageTorrents(torrents, action);
  }

  // Modular cleanup: Stop torrents that are 100% downloaded but still uploading
  async _stopFullyDownloadedTorrents(allTorrents) {
    const fullyDownloadedTorrents = allTorrents.filter(torrent =>
      torrent.tags === config.QBITTORRENT.TAG &&
      torrent.progress === 1 && // 100% complete
      torrent.state !== "stoppedDL" &&
      torrent.state !== "stoppedUP"
    );

    await this._processTorrentBatch(
      fullyDownloadedTorrents,
      "stop",
      "[STOP] Stopping upload (100% complete):"
    );

    return fullyDownloadedTorrents.length;
  }

  // Modular cleanup: Delete torrents in the 'completed' category
  async _deleteCompletedTorrents(allTorrents) {
    const completedTorrents = allTorrents.filter(torrent =>
      torrent.tags === config.QBITTORRENT.TAG &&
      torrent.category === config.QBITTORRENT.CATEGORY_COMPLETED
    );

    await this._processTorrentBatch(
      completedTorrents,
      "delete",
      "[CLEANUP] Completed:"
    );

    return completedTorrents.length;
  }

  // Modular cleanup: Delete stalled, errored, or missing file torrents
  async _deleteStalledTorrents(allTorrents) {
    const stalledTorrents = allTorrents.filter(torrent =>
      torrent.tags === config.QBITTORRENT.TAG &&
      torrent.category === config.QBITTORRENT.CATEGORY_ACTIVE &&
      (torrent.state === "stalledDL" ||
        torrent.state === "error" ||
        torrent.state === "missingFiles")
    );

    await this._processTorrentBatch(
      stalledTorrents,
      "delete",
      "[CLEANUP] Stalled/Error:",
      "warning"
    );

    return stalledTorrents.length;
  }

  // Modular cleanup: Delete ALL stopped torrents with the tag
  async _deleteStoppedTorrents(allTorrents) {
    const stoppedTorrents = allTorrents.filter(torrent =>
      torrent.tags === config.QBITTORRENT.TAG &&
      (torrent.state === "stoppedDL" || torrent.state === "stoppedUP")
    );

    await this._processTorrentBatch(
      stoppedTorrents,
      "delete",
      "[CLEANUP] Stopped (Tag):",
      "warning"
    );

    return stoppedTorrents.length;
  }

  // Main cleanup orchestrator
  async cleanupCompletedTorrents() {
    try {
      const allTorrents = await this.getTorrents();

      // Execute all cleanup operations in sequence
      await this._stopFullyDownloadedTorrents(allTorrents);
      //await this._deleteCompletedTorrents(allTorrents);
      await this._deleteStalledTorrents(allTorrents);
      //await this._deleteStoppedTorrents(allTorrents);

    } catch (error) {
      log.error("Failed to cleanup torrents", error);
    }
  }
}

module.exports = new QBittorrentClient();