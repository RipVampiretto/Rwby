// ============================================================================
// CAS BAN SYNC - Download and import CAS ban list
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
 * Download and sync CAS ban list
 * @returns {Promise<{success: boolean, message: string, newBans: number}>}
 */
async function syncCasBans() {
    const startTime = Date.now();
    logger.info('[cas-ban] Starting CAS sync...');

    try {
        // Download CSV
        const csvData = await downloadCsv();
        logger.info(`[cas-ban] Downloaded ${csvData.length} bytes`);

        // Parse CSV
        const users = parseCsv(csvData);
        logger.info(`[cas-ban] Parsed ${users.length} users from CSV`);

        // Find existing users to detect new ones
        const existingRows = await db.queryAll('SELECT user_id FROM cas_bans');
        const existingIds = new Set(existingRows.map(r => r.user_id));

        // Filter new users
        const newUsers = users.filter(u => !existingIds.has(u.user_id));
        logger.info(`[cas-ban] Found ${newUsers.length} new CAS bans`);

        // Bulk insert with batching
        await bulkInsert(users);

        // Update detection cache
        await detection.reloadCache();

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const message = `✅ **CAS Sync Completata**\n\n` +
            `📊 Totale: ${users.length.toLocaleString()} utenti\n` +
            `🆕 Nuovi: ${newUsers.length.toLocaleString()}\n` +
            `⏱️ Tempo: ${elapsed}s`;

        // If there are new bans, execute global bans and notify
        if (newUsers.length > 0) {
            await actions.processNewCasBans(newUsers);
        }

        logger.info(`[cas-ban] Sync completed in ${elapsed}s`);
        return { success: true, message, newBans: newUsers.length };

    } catch (e) {
        logger.error(`[cas-ban] Sync failed: ${e.message}`);
        return { success: false, message: `❌ Sync fallito: ${e.message}`, newBans: 0 };
    }
}

/**
 * Download CSV from CAS API
 */
function downloadCsv() {
    return new Promise((resolve, reject) => {
        const chunks = [];

        https.get(CAS_EXPORT_URL, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }

            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            res.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * Parse CAS CSV format: user_id,offenses,timestamp
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

    return users;
}

/**
 * Bulk insert users with batching (PostgreSQL)
 */
async function bulkInsert(users) {
    // Process in batches
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);

        // Build bulk INSERT with ON CONFLICT
        const values = [];
        const placeholders = batch.map((user, idx) => {
            const offset = idx * 3;
            values.push(user.user_id, user.offenses, user.time_added);
            return `($${offset + 1}, $${offset + 2}, $${offset + 3}, NOW())`;
        }).join(', ');

        await db.query(`
            INSERT INTO cas_bans (user_id, offenses, time_added, imported_at)
            VALUES ${placeholders}
            ON CONFLICT (user_id) DO UPDATE SET
                offenses = EXCLUDED.offenses,
                time_added = EXCLUDED.time_added,
                imported_at = NOW()
        `, values);

        logger.debug(`[cas-ban] Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}`);
    }
}

module.exports = {
    init,
    syncCasBans
};
