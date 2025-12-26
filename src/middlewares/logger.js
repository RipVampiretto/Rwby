/**
 * @fileoverview Logger centralizzato basato su Winston con formato strutturato
 * @module middlewares/logger
 *
 * @description
 * Sistema di logging con output su console e file.
 * Supporta formato strutturato con colonne allineate:
 * [data orario] [livello] [nome chat] [chat id] [nome utente] [messaggio]
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
 * Larghezze delle colonne per l'allineamento
 * @constant {Object}
 */
const COLUMN_WIDTHS = {
    level: 5, // DEBUG, INFO, WARN, ERROR
    group: 20, // Nome gruppo/modulo
    chatId: 15, // Chat ID
    user: 16 // Nome utente
};

/**
 * Simbolo per valori assenti
 * @constant {string}
 */
const EMPTY_SYMBOL = '—';

/**
 * Colori ANSI per i livelli
 * @constant {Object}
 */
const LEVEL_COLORS = {
    debug: '\x1b[34m', // Blu
    info: '\x1b[32m', // Verde
    warn: '\x1b[33m', // Giallo
    error: '\x1b[31m' // Rosso
};
const RESET_COLOR = '\x1b[0m';

/**
 * Tronca o padda una stringa alla lunghezza specificata
 * @param {string} str - Stringa da formattare
 * @param {number} len - Lunghezza desiderata
 * @returns {string} Stringa formattata
 */
function padOrTruncate(str, len) {
    if (!str || str === EMPTY_SYMBOL) {
        return EMPTY_SYMBOL.padEnd(len);
    }
    str = String(str);
    if (str.length > len) {
        return str.substring(0, len - 1) + '…';
    }
    return str.padEnd(len);
}

/**
 * Formatta il timestamp in formato italiano
 * @returns {string} Timestamp formattato
 */
function getItalyTimestamp() {
    return new Intl.DateTimeFormat('it-IT', {
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
}

/**
 * Formatta il livello di log con padding
 * @param {string} level - Livello di log
 * @returns {string} Livello formattato
 */
function formatLevel(level) {
    return level.toUpperCase().padEnd(COLUMN_WIDTHS.level);
}

/**
 * Costruisce il messaggio formattato con colonne allineate
 * @param {string} level - Livello di log
 * @param {string} message - Messaggio
 * @param {Object} context - Contesto aggiuntivo
 * @param {boolean} useColors - Se usare colori/emoji
 * @returns {string} Messaggio formattato
 */
function buildFormattedMessage(level, message, context = {}, useColors = false) {
    const timestamp = getItalyTimestamp();
    const formattedLevel = formatLevel(level);
    const group = padOrTruncate(context.group || context.module || EMPTY_SYMBOL, COLUMN_WIDTHS.group);
    const chatId = padOrTruncate(context.chatId || EMPTY_SYMBOL, COLUMN_WIDTHS.chatId);
    const user = padOrTruncate(context.user || EMPTY_SYMBOL, COLUMN_WIDTHS.user);

    if (useColors) {
        const color = LEVEL_COLORS[level] || '';
        return `[${timestamp}] ${color}[${formattedLevel}]${RESET_COLOR} [${group}] [${chatId}] [${user}] ${message}`;
    }

    return `[${timestamp}] [${formattedLevel}] [${group}] [${chatId}] [${user}] ${message}`;
}

/**
 * Formato console con colori e struttura.
 * @private
 */
const consoleFormat = winston.format.combine(
    winston.format.printf(({ level, message, group, chatId, user, module: mod }) => {
        const context = { group, chatId, user, module: mod };
        return buildFormattedMessage(level, message, context, true);
    })
);

/**
 * Formato file (senza colori).
 * @private
 */
const fileFormat = winston.format.combine(
    winston.format.printf(({ level, message, group, chatId, user, module: mod }) => {
        const context = { group, chatId, user, module: mod };
        return buildFormattedMessage(level, message, context, false);
    })
);

/**
 * Istanza del logger Winston.
 * @private
 */
const winstonLogger = winston.createLogger({
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
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5,
            tailable: true
        }),

        // File solo errori
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'error.log'),
            level: 'error',
            format: fileFormat,
            maxsize: 5 * 1024 * 1024,
            maxFiles: 3,
            tailable: true
        }),

        // File info
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'info.log'),
            level: 'info',
            format: fileFormat,
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5,
            tailable: true
        }),

        // File debug
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'debug.log'),
            level: 'debug',
            format: fileFormat,
            maxsize: 10 * 1024 * 1024,
            maxFiles: 3,
            tailable: true
        }),

        // File warning
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'warn.log'),
            level: 'warn',
            format: fileFormat,
            maxsize: 5 * 1024 * 1024,
            maxFiles: 3,
            tailable: true
        })
    ]
});

/**
 * Estrae contesto da un oggetto grammY ctx
 * @param {Object} ctx - Contesto grammY
 * @returns {Object} Contesto estratto {group, user}
 */
function extractContext(ctx) {
    if (!ctx) return {};

    const result = {};

    // Estrai nome gruppo e chat ID
    if (ctx.chat) {
        if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
            result.group = ctx.chat.title || `ID:${ctx.chat.id}`;
        }
        result.chatId = String(ctx.chat.id);
    }

    // Estrai nome utente
    if (ctx.from) {
        result.user = ctx.from.first_name || ctx.from.username || `ID:${ctx.from.id}`;
    }

    return result;
}

/**
 * Logger API pubblica
 */
module.exports = {
    /**
     * Logga un messaggio a livello DEBUG.
     * @param {string} message - Messaggio da loggare
     * @param {Object} [context] - Contesto opzionale {group, user, module} oppure ctx grammY
     */
    debug(message, context) {
        const ctx = context?.chat ? extractContext(context) : context;
        winstonLogger.debug(message, ctx || {});
    },

    /**
     * Logga un messaggio a livello INFO.
     * @param {string} message - Messaggio da loggare
     * @param {Object} [context] - Contesto opzionale {group, user, module} oppure ctx grammY
     */
    info(message, context) {
        const ctx = context?.chat ? extractContext(context) : context;
        winstonLogger.info(message, ctx || {});
    },

    /**
     * Logga un messaggio a livello WARN.
     * @param {string} message - Messaggio da loggare
     * @param {Object} [context] - Contesto opzionale {group, user, module} oppure ctx grammY
     */
    warn(message, context) {
        const ctx = context?.chat ? extractContext(context) : context;
        winstonLogger.warn(message, ctx || {});
    },

    /**
     * Logga un messaggio a livello ERROR.
     * @param {string} message - Messaggio da loggare
     * @param {Object} [context] - Contesto opzionale {group, user, module} oppure ctx grammY
     */
    error(message, context) {
        const ctx = context?.chat ? extractContext(context) : context;
        winstonLogger.error(message, ctx || {});
    },

    /**
     * Crea un logger child con modulo prefissato
     * @param {string} moduleName - Nome del modulo
     * @returns {Object} Logger con modulo prefissato
     */
    module(moduleName) {
        return {
            debug: (msg, ctx) =>
                module.exports.debug(msg, { ...extractContext(ctx), module: moduleName, ...(ctx?.chat ? {} : ctx) }),
            info: (msg, ctx) =>
                module.exports.info(msg, { ...extractContext(ctx), module: moduleName, ...(ctx?.chat ? {} : ctx) }),
            warn: (msg, ctx) =>
                module.exports.warn(msg, { ...extractContext(ctx), module: moduleName, ...(ctx?.chat ? {} : ctx) }),
            error: (msg, ctx) =>
                module.exports.error(msg, { ...extractContext(ctx), module: moduleName, ...(ctx?.chat ? {} : ctx) })
        };
    },

    /**
     * Logga direttamente da un contesto grammY
     * @param {Object} ctx - Contesto grammY
     * @returns {Object} Logger con contesto estratto
     */
    ctx(ctx) {
        const extracted = extractContext(ctx);
        return {
            debug: msg => module.exports.debug(msg, extracted),
            info: msg => module.exports.info(msg, extracted),
            warn: msg => module.exports.warn(msg, extracted),
            error: msg => module.exports.error(msg, extracted)
        };
    }
};
