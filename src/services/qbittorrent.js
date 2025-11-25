const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const config = require("../config");
const { log } = require("../utils/logger");

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
    form.append("torrents", fs.createReadStream(torrentFile));
    form.append("stopped", "true");
    form.append("category", "radarr");
    form.append("tags", "tamilmv");

    try {
      await axios.post(`${config.TORRENT_URL}/add`, form, {
        headers: {
          ...form.getHeaders(),
          "User-Agent": "Fiddler",
          Cookie: `SID=${sid}`,
        },
      });
      return true;
    } catch (error) {
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
          torrent.tags === "tamilmv" &&
          torrent.category === "radarr"
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
      }

      try {
        await axios.post(`${config.TORRENT_URL}/${action}`, form, {
          headers: {
            ...form.getHeaders(),
            Cookie: `SID=${sid}`,
          },
        });

        const movieName = torrent.name.split(/\(\d{4}\)/)[0].trim().split("- ")[1]?.toUpperCase() || torrent.name;
        const sizeGB = (torrent.size / 1024 ** 3).toFixed(2);
        
        log.success(`${action.toUpperCase()}${reason ? ` ${reason}` : ''} ${movieName} (${sizeGB} GB)`);
      } catch (error) {
        log.error(`Failed to ${action} torrent: ${torrent.name}`);
      }
    }
  }
}

module.exports = new QBittorrentClient();