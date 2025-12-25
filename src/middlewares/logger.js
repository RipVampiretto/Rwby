/**
 * @fileoverview Logger centralizzato basato su Winston
 * @module middlewares/logger
 *
 * @description
 * Sistema di logging con output su console e file.
 * Utilizza il fuso orario italiano (Europe/Rome) per i timestamp.
 *
 * **File di log generati:**
 * - `combined.log` - Tutti i log (10MB x 5 file)
 * - `error.log` - Solo errori (5MB x 3 file)
 * - `info.log` - Info e superiori (10MB x 5 file)
 * - `debug.log` - Debug e superiori (10MB x 3 file)
 * - `warn.log` - Warning e superiori (5MB x 3 file)
 *
 * @requires winston
 */

const winston = require('winston');
const path = require('path');

/**
 * Directory per i file di log.
 * @constant {string}
 */
const LOG_DIR = path.join(process.cwd(), 'logs');

/**
 * Formato personalizzato per timestamp con fuso orario italiano.
 * @private
 */
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

/**
 * Formato console con colori.
 * @private
 */
const consoleFormat = winston.format.combine(
    italyTimestamp(),
    winston.format.colorize(),
    winston.format.printf(({ level, message, timestamp }) => {
        return `[${timestamp}] [${level}] ${message}`;
    })
);

/**
 * Formato file (senza colori).
 * @private
 */
const fileFormat = winston.format.combine(
    italyTimestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
        return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    })
);

/**
 * Istanza del logger Winston.
 * @private
 */
const logger = winston.createLogger({
    level: 'debug',
    transports: [
        // Console (colorizzata)
        new winston.transports.Console({
            format: consoleFormat
        }),

        // File combinato
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'combined.log'),
            format: fileFormat,
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            tailable: true
        }),

        // File solo errori
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'error.log'),
            level: 'error',
            format: fileFormat,
            maxsize: 5 * 1024 * 1024, // 5MB
            maxFiles: 3,
            tailable: true
        }),

        // File info
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'info.log'),
            level: 'info',
            format: fileFormat,
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            tailable: true
        }),

        // File debug
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'debug.log'),
            level: 'debug',
            format: fileFormat,
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 3,
            tailable: true
        }),

        // File warning
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

module.exports = {
    /**
     * Logga un messaggio a livello DEBUG.
     * @param {string} message - Messaggio da loggare
     */
    debug(message) {
        logger.debug(message);
    },

    /**
     * Logga un messaggio a livello INFO.
     * @param {string} message - Messaggio da loggare
     */
    info(message) {
        logger.info(message);
    },

    /**
     * Logga un messaggio a livello WARN.
     * @param {string} message - Messaggio da loggare
     */
    warn(message) {
        logger.warn(message);
    },

    /**
     * Logga un messaggio a livello ERROR.
     * @param {string} message - Messaggio da loggare
     */
    error(message) {
        logger.error(message);
    }
};
