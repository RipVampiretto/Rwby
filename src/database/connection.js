/**
 * @fileoverview Gestione connessione pool PostgreSQL
 * @module database/connection
 *
 * @description
 * Gestisce il pool di connessioni PostgreSQL e fornisce
 * utility per l'esecuzione di query. Include wrapper di
 * compatibilità per codice legacy che usava better-sqlite3.
 *
 * @requires pg
 * @requires ../middlewares/logger
 */

const { Pool } = require('pg');
const logger = require('../middlewares/logger');

/**
 * Pool di connessioni PostgreSQL.
 * @type {import('pg').Pool|null}
 * @private
 */
let pool = null;

/**
 * Inizializza il pool di connessioni PostgreSQL.
 *
 * @returns {Promise<import('pg').Pool>} Istanza del pool
 * @throws {Error} Se la connessione fallisce
 */
async function init() {
    const config = {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT) || 5432,
        database: process.env.POSTGRES_DB || 'rwby_bot',
        user: process.env.POSTGRES_USER || 'rwby',
        password: process.env.POSTGRES_PASSWORD || 'rwby_secure_password',
        max: 20, // Dimensione massima pool
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    };

    pool = new Pool(config);

    // Test connessione
    try {
        const client = await pool.connect();
        await client.query('SELECT NOW()');
        client.release();
        logger.info(`PostgreSQL connected: ${config.host}:${config.port}/${config.database}`);
    } catch (err) {
        logger.error(`PostgreSQL connection failed: ${err.message}`);
        throw err;
    }

    // Gestione errori pool
    pool.on('error', err => {
        logger.error(`PostgreSQL pool error: ${err.message}`);
    });

    return pool;
}

/**
 * Ottiene l'istanza del pool.
 *
 * @returns {import('pg').Pool} Pool di connessioni
 * @throws {Error} Se il database non è inizializzato
 */
function getPool() {
    if (!pool) {
        throw new Error('Database not initialized. Call init() first.');
    }
    return pool;
}

/**
 * Esegue una query SQL.
 * Logga query lente (>1s) come warning.
 *
 * @param {string} text - Query SQL
 * @param {Array} [params=[]] - Parametri della query
 * @returns {Promise<import('pg').QueryResult>} Risultato della query
 * @throws {Error} Se la query fallisce
 */
async function query(text, params = []) {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        if (duration > 1000) {
            logger.warn(`Slow query (${duration}ms): ${text.substring(0, 100)}`);
        }
        return result;
    } catch (err) {
        logger.error(`Query error: ${err.message} - Query: ${text.substring(0, 100)}`);
        throw err;
    }
}

/**
 * Esegue una query e restituisce la prima riga.
 *
 * @param {string} text - Query SQL
 * @param {Array} [params=[]] - Parametri della query
 * @returns {Promise<Object|null>} Prima riga o null
 */
async function queryOne(text, params = []) {
    const result = await query(text, params);
    return result.rows[0] || null;
}

/**
 * Esegue una query e restituisce tutte le righe.
 *
 * @param {string} text - Query SQL
 * @param {Array} [params=[]] - Parametri della query
 * @returns {Promise<Array>} Array di righe
 */
async function queryAll(text, params = []) {
    const result = await query(text, params);
    return result.rows;
}

/**
 * Chiude il pool di connessioni.
 *
 * @returns {Promise<void>}
 */
async function close() {
    if (pool) {
        await pool.end();
        pool = null;
        logger.info('PostgreSQL pool closed');
    }
}

/**
 * Wrapper di compatibilità per codice legacy che usava better-sqlite3.
 * Restituisce un oggetto che simula l'API di better-sqlite3 ma usa PostgreSQL.
 *
 * @returns {Object} Oggetto con metodo prepare()
 * @throws {Error} Se il database non è inizializzato
 */
function getDb() {
    if (!pool) {
        throw new Error('Database not initialized. Call init() first.');
    }

    return {
        /**
         * Prepara una query (converte placeholder da ? a $1, $2, etc.)
         * @param {string} sql - Query SQL con placeholder ?
         */
        prepare: sql => {
            // Converte placeholder SQLite (?) a PostgreSQL ($1, $2, ...)
            let paramIndex = 0;
            const pgSql = sql.replace(/\?/g, () => `$${++paramIndex}`);

            return {
                get: async (...params) => {
                    const result = await pool.query(pgSql, params);
                    return result.rows[0] || null;
                },
                all: async (...params) => {
                    const result = await pool.query(pgSql, params);
                    return result.rows;
                },
                run: async (...params) => {
                    const result = await pool.query(pgSql, params);
                    return {
                        changes: result.rowCount,
                        lastInsertRowid: result.rows[0]?.id || null
                    };
                }
            };
        }
    };
}

module.exports = {
    init,
    getPool,
    /** Wrapper compatibilità per codice legacy */
    getDb,
    query,
    queryOne,
    queryAll,
    close
};
