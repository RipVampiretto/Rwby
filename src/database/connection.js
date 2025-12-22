const { Pool } = require('pg');
const logger = require('../middlewares/logger');

let pool = null;

/**
 * Initialize PostgreSQL connection pool
 * @returns {Promise<Pool>} PostgreSQL pool instance
 */
async function init() {
    const config = {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT) || 5432,
        database: process.env.POSTGRES_DB || 'rwby_bot',
        user: process.env.POSTGRES_USER || 'rwby',
        password: process.env.POSTGRES_PASSWORD || 'rwby_secure_password',
        max: 20, // Maximum pool size
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    };

    pool = new Pool(config);

    // Test connection
    try {
        const client = await pool.connect();
        await client.query('SELECT NOW()');
        client.release();
        logger.info(`PostgreSQL connected: ${config.host}:${config.port}/${config.database}`);
    } catch (err) {
        logger.error(`PostgreSQL connection failed: ${err.message}`);
        throw err;
    }

    // Handle pool errors
    pool.on('error', err => {
        logger.error(`PostgreSQL pool error: ${err.message}`);
    });

    return pool;
}

/**
 * Get pool instance
 * @returns {Pool}
 */
function getPool() {
    if (!pool) {
        throw new Error('Database not initialized. Call init() first.');
    }
    return pool;
}

/**
 * Execute a query
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<object>}
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
 * Get a single row
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<object|null>}
 */
async function queryOne(text, params = []) {
    const result = await query(text, params);
    return result.rows[0] || null;
}

/**
 * Get multiple rows
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>}
 */
async function queryAll(text, params = []) {
    const result = await query(text, params);
    return result.rows;
}

/**
 * Close pool
 */
async function close() {
    if (pool) {
        await pool.end();
        pool = null;
        logger.info('PostgreSQL pool closed');
    }
}

/**
 * Compatibility wrapper for legacy code using db.getDb().prepare()
 * This allows gradual migration - legacy code will still work
 * Returns an object that mimics better-sqlite3 API but uses PostgreSQL
 */
function getDb() {
    if (!pool) {
        throw new Error('Database not initialized. Call init() first.');
    }

    return {
        prepare: sql => {
            // Convert SQLite placeholders (?) to PostgreSQL ($1, $2, ...)
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
    getDb, // Compatibility wrapper
    query,
    queryOne,
    queryAll,
    close
};
