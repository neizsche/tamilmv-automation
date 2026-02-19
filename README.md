# TamilMV Automation

![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)
![Node.js Version](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)
![Code Style: Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)

Automates downloading movies from TamilMV RSS feeds to QBittorrent and Radarr.

## Features

- 🔄 **RSS Monitoring**: Automatically checks for new releases (default: 1-3GB files).
- 📥 **Smart Filtering**: Filters torrents based on size and existing library status.
- 🎬 **Radarr Integration**: Checks if movies are already monitored or downloaded in Radarr.
- ⚡ **QBittorrent Control**: Adds torrents with specific categories/tags and manages download state.
- 🔔 **Notifications**: Sends alerts for errors and successful adds via ntfy.sh.
- 🔍 **Dynamic Domain Resolution**: Automatically finds working proxies/mirrors for TamilMV.

## Quick Start

1.  **Clone & Install**

    ```bash
    git clone <repo-url>
    cd tamilmv-automation
    npm install
    ```

2.  **Configure**

    ```bash
    cp .env.example .env
    nano .env
    ```

    **Enable Feeds:**
    In `.env`, set `true` for the feeds you want to monitor:

    ```ini
    ENABLE_MALAYALAM_HD=true
    ENABLE_HINDI_HD=true
    ENABLE_TAMIL_HD=false
    # ... and others
    ```

    **Configuration Variables (.env)**

    | Variable          | Description                    | Default                 |
    | ----------------- | ------------------------------ | ----------------------- |
    | `QBITTORRENT_URL` | URL of qBittorrent WebUI       | `http://localhost:8080` |
    | `USERNAME`        | qBittorrent Username           | `admin`                 |
    | `PASSWORD`        | qBittorrent Password           | `adminadmin`            |
    | `RADARR_URL`      | URL of Radarr                  | `http://localhost:7878` |
    | `RADARR_API_KEY`  | API Key for Radarr             | -                       |
    | `CHECK_INTERVAL`  | Interval to check feeds (ms)   | `600000` (10 min)       |
    | `ENABLE_*`        | Enable specific language feeds | `true`/`false`          |
    | `NTFY_URL`        | URL for ntfy.sh notifications  | -                       |

    **Custom Feed:**

    ```ini
    CUSTOM_FEED_NAME=my_custom_feed
    CUSTOM_FEED_PATH=forums/forum/123-custom-feed.xml
    ```

3.  **Run Manually**
    ```bash
    npm start
    # Options: -- --ignore-feed --days=7
    ```

## Service Automation (Systemd)

To run as a background service on Linux:

1.  **Create Service File**
    `sudo nano /etc/systemd/system/tamilmv-automation.service`

    ```ini
    [Unit]
    Description=TamilMV Automation
    After=network.target

    [Service]
    Type=simple
    User=your-user
    WorkingDirectory=/path/to/tamilmv-automation
    ExecStart=/usr/bin/node /path/to/tamilmv-automation/src/main.js
    Restart=always
    RestartSec=30
    Environment=NODE_ENV=production

    [Install]
    WantedBy=multi-user.target
    ```

    _Note: Adjust paths and User if necessary._

2.  **Enable & Start**

    ```bash
    sudo systemctl daemon-reload
    sudo systemctl enable tamilmv-automation
    sudo systemctl start tamilmv-automation
    ```

3.  **Manage**
    ```bash
    sudo systemctl status tamilmv-automation
    sudo journalctl -u tamilmv-automation -f
    ```

## Troubleshooting

- **Missing env vars**: Check `.env` matches `.env.example`.
- **Connection errors**: Verify QBittorrent/Radarr URLs and credentials.
- **Logs**: `tail -f automation.log`

## Architecture

The project is structured to separate concerns:

- **`src/main.js`**: Entry point. Initializes services and handles cleanup.
- **`src/services/rssMonitor.js`**: Monitors RSS feeds for new items.
- **`src/processors/orchestrator.js`**: Coordinates the flow: download -> filter -> add to qBit -> check Radarr.
- **`src/processors/filter.js`**: Implements logic to filter torrents by size and duplicates.
- **`src/services/qbittorrent.js`**: Wrapper for qBittorrent Web API.
- **`src/services/radarr.js`**: Wrapper for Radarr API (movie lookup/adding).
- **`src/services/domainResolver.js`**: Finds working domains for TamilMV.

## Security

> [!IMPORTANT]
> **Never commit your `.env` file.** This file contains sensitive information like your API keys and passwords. Ensure it is listed in your `.gitignore`.

## Disclaimer

This software is for educational purposes only. The authors do not condone piracy or the illegal downloading of copyrighted material. Users are responsible for ensuring their use of this software complies with local laws and regulations.
