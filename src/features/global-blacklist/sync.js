// ============================================================================
// CAS BAN SYNC - Download and import CAS ban list (OPTIMIZED)
// ============================================================================

const https = require('https');
const logger = require('../../middlewares/logger');
const detection = require('./detection');
const actions = require('./actions');

let db = null;
let _botInstance = null;

const CAS_EXPORT_URL = 'https://api.cas.chat/export.csv';
const BATCH_SIZE = 10000;

function init(database, bot) {
    db = database;
    _botInstance = bot;
}

/**
 * Download and sync CAS ban list (OPTIMIZED - incremental sync)
 */
async function syncCasBans() {
    const startTime = Date.now();
    logger.info('[global-blacklist] Starting CAS sync...');

    try {
        // 1. Get the highest user_id we already have
        const lastRow = await db.queryOne('SELECT MAX(user_id) as max_id FROM cas_bans');
        const lastKnownId = lastRow?.max_id || 0;
        logger.info(`[global-blacklist] Last known CAS ID in DB: ${lastKnownId}`);

        // 2. Download CSV
        const csvData = await downloadCsv();
        logger.info(`[global-blacklist] Downloaded ${csvData.length} bytes`);

        // 3. Parse CSV and filter only NEW users (ID > lastKnownId)
        const allUsers = parseCsv(csvData);
        const newUsers = allUsers.filter(u => u.user_id > lastKnownId);

        logger.info(
            `[global-blacklist] Parsed ${allUsers.length} total users, ${newUsers.length} are new (ID > ${lastKnownId})`
        );

        if (newUsers.length === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            logger.info(`[global-blacklist] No new CAS bans, sync completed in ${elapsed}s`);
            return {
                success: true,
                message: `✅ <b>CAS Sync Completata</b>\n\nNessun nuovo ban da aggiungere.`,
                newBans: 0
            };
        }

        // 4. Bulk insert ONLY new users
        await bulkInsert(newUsers);

        // 5. Update detection cache
        await detection.reloadCache();

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const message =
            `✅ <b>CAS Sync Completata</b>\n\n` +
            `📊 Totale nel file: ${allUsers.length.toLocaleString()}\n` +
            `🆕 Nuovi aggiunti: ${newUsers.length.toLocaleString()}\n` +
            `⏱️ Tempo: ${elapsed}s`;

        // 6. If there are new bans, execute global bans and notify
        if (newUsers.length > 0) {
            await actions.processNewCasBans(newUsers);
        }

        logger.info(`[global-blacklist] Sync completed in ${elapsed}s - added ${newUsers.length} new bans`);
        return { success: true, message, newBans: newUsers.length };
    } catch (e) {
        logger.error(`[global-blacklist] Sync failed: ${e.message}`);
        return { success: false, message: `❌ Sync fallito: ${e.message}`, newBans: 0 };
    }
}

/**
 * Download CSV from CAS API
 */
function downloadCsv() {
    return new Promise((resolve, reject) => {
        const chunks = [];

        https
            .get(CAS_EXPORT_URL, res => {
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }

                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                res.on('error', reject);
            })
            .on('error', reject);
    });
}

/**
 * Parse CAS CSV format: user_id,offenses,timestamp
 * Returns users SORTED by user_id ascending for efficient incremental sync
 */
function parseCsv(csvData) {
    const lines = csvData.split('\n');
    const users = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (line.startsWith('user_id') || line.startsWith('id')) continue;

        const parts = line.split(',');
        if (parts.length >= 1) {
            const userId = parseInt(parts[0], 10);
            if (!isNaN(userId) && userId > 0) {
                users.push({
                    user_id: userId,
                    offenses: parseInt(parts[1], 10) || 1,
                    time_added: parts[2] || null
                });
            }
        }
    }

    // Sort by user_id for consistent ordering
    users.sort((a, b) => a.user_id - b.user_id);
    return users;
}

/**
 * Bulk insert users with batching (PostgreSQL)
 * Uses INSERT ... ON CONFLICT DO NOTHING for efficiency
 */
async function bulkInsert(users) {
    if (users.length === 0) return;

    let inserted = 0;
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);

        // Build bulk INSERT with ON CONFLICT DO NOTHING
        const values = [];
        const placeholders = batch
            .map((user, idx) => {
                const offset = idx * 3;
                values.push(user.user_id, user.offenses, user.time_added);
                return `($${offset + 1}, $${offset + 2}, $${offset + 3}, NOW())`;
            })
            .join(', ');

        const result = await db.query(
            `
            INSERT INTO cas_bans (user_id, offenses, time_added, imported_at)
            VALUES ${placeholders}
            ON CONFLICT (user_id) DO NOTHING
        `,
            values
        );

        inserted += result.rowCount || batch.length;
        logger.debug(`[global-blacklist] Inserted batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} rows)`);
    }

    logger.info(`[global-blacklist] Inserted ${inserted} new CAS bans`);
}

module.exports = {
    init,
    syncCasBans
};
