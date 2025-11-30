# TamilMV Automation

Automates downloading movies from TamilMV RSS feeds to QBittorrent and Radarr.

if env is not setup then fail or stop 
once radarr move is completed then delete the torrent
parallel processing and optimizing for speed
move radarr tags and categories and noofdaysrssshouldfetch to env variables
move radarr logs 
if movie already exists in radarr(available) then dont even start but delete
