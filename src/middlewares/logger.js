const fs = require('fs');
const path = require('path');

/* ==========================
   Configuration
========================== */

const LOG_DIR = path.join('logs');

const LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

/* ==========================
   Init
========================== */

// Create logs directory if it doesn't exist
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

/* ==========================
   Utils
========================== */

function formatItalyDate(date = new Date()) {
    return new Intl.DateTimeFormat('it-IT', {
        timeZone: 'Europe/Rome',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    })
        .format(date)
        .replace(',', '');
}

function writeLog(level, message) {
    const timestamp = formatItalyDate();
    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;

    // Write level-specific log
    fs.appendFileSync(
        path.join(LOG_DIR, `${level}.log`),
        logLine
    );

    // Write combined log
    fs.appendFileSync(
        path.join(LOG_DIR, 'combined.log'),
        logLine
    );

    // Console output
    switch (level) {
        case 'error':
            console.error(logLine.trim());
            break;
        case 'warn':
            console.warn(logLine.trim());
            break;
        default:
            console.log(logLine.trim());
    }
}

/* ==========================
   Public API
========================== */

const logger = {
    debug(message) {
        writeLog('debug', message);
    },

    info(message) {
        writeLog('info', message);
    },

    warn(message) {
        writeLog('warn', message);
    },

    error(message) {
        writeLog('error', message);
    }
};

module.exports = logger;