const winston = require('winston');
const path = require('path');

/* ==========================
   Configuration
========================== */

const LOG_DIR = path.join(process.cwd(), 'logs');

// Custom format for Italy timezone
const italyTimestamp = winston.format(info => {
    info.timestamp = new Intl.DateTimeFormat('it-IT', {
        timeZone: 'Europe/Rome',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    })
        .format(new Date())
        .replace(',', '');
    return info;
});

// Console format with colors
const consoleFormat = winston.format.combine(
    italyTimestamp(),
    winston.format.colorize(),
    winston.format.printf(({ level, message, timestamp }) => {
        return `[${timestamp}] [${level}] ${message}`;
    })
);

// File format (no colors)
const fileFormat = winston.format.combine(
    italyTimestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
        return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    })
);

/* ==========================
   Winston Logger Instance
========================== */

const logger = winston.createLogger({
    level: 'debug',
    transports: [
        // Console transport (colorized)
        new winston.transports.Console({
            format: consoleFormat
        }),

        // Combined log file
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'combined.log'),
            format: fileFormat,
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            tailable: true
        }),

        // Error-only log file
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'error.log'),
            level: 'error',
            format: fileFormat,
            maxsize: 5 * 1024 * 1024, // 5MB
            maxFiles: 3,
            tailable: true
        }),

        // Info-level log file
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'info.log'),
            level: 'info',
            format: fileFormat,
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            tailable: true
        }),

        // Debug-level log file
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'debug.log'),
            level: 'debug',
            format: fileFormat,
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 3,
            tailable: true
        }),

        // Warn-level log file
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'warn.log'),
            level: 'warn',
            format: fileFormat,
            maxsize: 5 * 1024 * 1024, // 5MB
            maxFiles: 3,
            tailable: true
        })
    ]
});

/* ==========================
   Public API (same interface)
========================== */

module.exports = {
    debug(message) {
        logger.debug(message);
    },

    info(message) {
        logger.info(message);
    },

    warn(message) {
        logger.warn(message);
    },

    error(message) {
        logger.error(message);
    }
};
