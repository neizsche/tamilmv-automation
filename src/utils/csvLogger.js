const fs = require("fs");
const path = require("path");
const { parseMovieName } = require("./helpers");

class CSVLogger {
    constructor() {
        this.csvPath = path.join(__dirname, "..", "..", "temp", "torrent_events.csv");
        this.ensureCSVExists();
    }

    ensureCSVExists() {
        // Ensure temp directory exists
        const tempDir = path.dirname(this.csvPath);
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Create CSV with headers if it doesn't exist
        if (!fs.existsSync(this.csvPath)) {
            const headers = "Movie Name,Size (GB),Added Time,Removed Time,Duration (hours)\n";
            fs.writeFileSync(this.csvPath, headers, "utf8");
        }
    }

    formatTimestamp() {
        const now = new Date();
        // Format: YYYY-MM-DD HH:MM:SS
        return now.toISOString().replace("T", " ").substring(0, 19);
    }

    escapeCSVField(field) {
        // Escape fields that contain commas, quotes, or newlines
        if (
            field.includes(",") ||
            field.includes('"') ||
            field.includes("\n")
        ) {
            return `"${field.replace(/"/g, '""')}"`;
        }
        return field;
    }

    calculateDuration(addedTime, removedTime) {
        try {
            const added = new Date(addedTime);
            const removed = new Date(removedTime);
            const durationMs = removed - added;
            const durationHours = (durationMs / (1000 * 60 * 60)).toFixed(2);
            return durationHours;
        } catch (error) {
            return "N/A";
        }
    }

    readCSV() {
        try {
            const content = fs.readFileSync(this.csvPath, "utf8");
            const lines = content.trim().split("\n");
            return lines;
        } catch (error) {
            console.error("Failed to read CSV:", error);
            return [];
        }
    }

    writeCSV(lines) {
        try {
            fs.writeFileSync(this.csvPath, lines.join("\n") + "\n", "utf8");
        } catch (error) {
            console.error("Failed to write CSV:", error);
        }
    }

    logAdded(movieName, sizeBytes) {
        try {
            const timestamp = this.formatTimestamp();
            const parsed = parseMovieName(movieName);
            const sizeGB = (sizeBytes / 1024 ** 3).toFixed(2);

            // Add new row with added time, empty removed time and duration
            const row = [
                this.escapeCSVField(parsed.display),
                sizeGB,
                timestamp,
                "", // Removed time - empty for now
                "", // Duration - empty for now
            ].join(",");

            fs.appendFileSync(this.csvPath, row + "\n", "utf8");
        } catch (error) {
            console.error("Failed to log added event:", error);
        }
    }

    logRemoved(movieName, sizeBytes) {
        try {
            const removedTime = this.formatTimestamp();
            const parsed = parseMovieName(movieName);
            const lines = this.readCSV();

            if (lines.length <= 1) return; // Only header exists

            let updated = false;
            const updatedLines = lines.map((line, index) => {
                if (index === 0) return line; // Keep header

                const parts = line.split(",");
                if (parts.length < 3) return line;

                // Check if this is the movie we're looking for (by name)
                const csvMovieName = parts[0].replace(/^"|"$/g, '').replace(/""/g, '"');
                if (csvMovieName === parsed.display && !parts[3]) {
                    // Movie found and not yet removed (no removed time)
                    const addedTime = parts[2];
                    const duration = this.calculateDuration(addedTime, removedTime);

                    // Update the row with removed time and duration
                    parts[3] = removedTime;
                    parts[4] = duration;
                    updated = true;
                    return parts.join(",");
                }
                return line;
            });

            if (updated) {
                this.writeCSV(updatedLines);
            }
        } catch (error) {
            console.error("Failed to log removed event:", error);
        }
    }
}

module.exports = new CSVLogger();
