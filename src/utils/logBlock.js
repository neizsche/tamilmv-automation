const { log } = require('./logger');

class LogBlock {
    constructor(title) {
        this.title = title;
        // Target width is roughly 60.
        // Title format: ┌─ TITLE ────────────────
        // End format:   └────────────────────────
        this.width = 58;
    }

    logTitle() {
        log.info('');
        // ┌─ (2 chars) + space (1) + TITLE + space (1) + padding = 60 chars total visual width?
        // Let's match the hardcoded strings directly.
        // '┌─ STARTUP ────────────────────────────────────────────────' length is 60.
        // '┌─ ' is 3 chars.
        // Title.
        // ' ' is 1 char.
        // Padding lines.

        const prefix = `┌─ ${this.title} `;
        const paddingLength = Math.max(0, 60 - prefix.length);
        const padding = '─'.repeat(paddingLength);
        log.info(`${prefix}${padding}`);
    }

    log(message) {
        log.info(`│  ${message}`);
    }

    separator() {
        log.info(`│  ${'─'.repeat(55)}`);
    }

    end() {
        // └ + 57 dashes
        log.info('└──────────────────────────────────────────────────────────');
        log.info('');
    }

    static async withBlock(title, fn) {
        const block = new LogBlock(title);
        try {
            block.logTitle();
            await fn(block);
        } finally {
            block.end();
        }
    }
}

module.exports = LogBlock;
