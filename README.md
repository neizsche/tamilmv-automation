# TamilMV Automation

Automates downloading movies from TamilMV RSS feeds to QBittorrent and Radarr.

## Features
- Monitors RSS feed for new releases (1-3GB)
- Auto-downloads to QBittorrent with categories/tags
- Integrates with Radarr
- Notifications via ntfy.sh

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
    *Note: Adjust paths and User if necessary.*

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

## Security

> [!IMPORTANT]
> **Never commit your `.env` file.** This file contains sensitive information like your API keys and passwords. Ensure it is listed in your `.gitignore`.

## Disclaimer

This software is for educational purposes only. The authors do not condone piracy or the illegal downloading of copyrighted material. Users are responsible for ensuring their use of this software complies with local laws and regulations.