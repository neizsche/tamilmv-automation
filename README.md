# TamilMV Automation

Monitors TamilMV RSS feeds and automatically adds torrents to QBittorrent, with Radarr integration to skip already-available movies.

## Setup

```bash
git clone <repo-url>
cd tamilmv-automation
npm install
cp .env.example .env
```

Edit `.env` with your details, then:

```bash
npm start
```

## Usage

```bash
node src/main.js [options]
```

| Flag            | Alias  | Description                                     |
| --------------- | ------ | ----------------------------------------------- |
| `--ignore-feed` | `-i`   | Skip feed scraping, process existing queue only |
| `--days=N`      | `-d N` | Fetch items from the last N days (default: `2`) |
| `--reset`       |        | Reset internal state and start fresh            |

## Configuration

| Variable                        | Description                                   |
| ------------------------------- | --------------------------------------------- |
| `QBITTORRENT_URL`               | qBittorrent WebUI URL                         |
| `USERNAME` / `PASSWORD`         | qBittorrent credentials                       |
| `RADARR_URL` / `RADARR_API_KEY` | Radarr connection                             |
| `CHECK_INTERVAL`                | Feed check interval in ms (default: `600000`) |
| `ENABLE_*`                      | Toggle language feeds (`true`/`false`)        |
| `NTFY_URL`                      | ntfy.sh push notification URL                 |

## Run as a Service (systemd)

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

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tamilmv-automation
```

## Disclaimer

For educational purposes only. Users are responsible for complying with local laws.
