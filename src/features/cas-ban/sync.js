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
const BATCH_SIZE = 10000; // Insert 10K rows per transaction for efficiency

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
        const existingIds = new Set(
            db.getDb().prepare('SELECT user_id FROM cas_bans').all().map(r => r.user_id)
        );

        // Filter new users
        const newUsers = users.filter(u => !existingIds.has(u.user_id));
        logger.info(`[cas-ban] Found ${newUsers.length} new CAS bans`);

        // Bulk insert with batching
        await bulkInsert(users);

        // Update detection cache
        detection.reloadCache();

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
 * @returns {Promise<string>}
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
 * @param {string} csvData 
 * @returns {Array<{user_id: number, offenses: number, time_added: string}>}
 */
function parseCsv(csvData) {
    const lines = csvData.split('\n');
    const users = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Skip header if present
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
 * Bulk insert users with transaction batching
 * @param {Array} users 
 */
async function bulkInsert(users) {
    const dbInstance = db.getDb();
    const insertStmt = dbInstance.prepare(`
        INSERT OR REPLACE INTO cas_bans (user_id, offenses, time_added, imported_at)
        VALUES (?, ?, ?, datetime('now'))
    `);

    // Process in batches
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);

        const transaction = dbInstance.transaction((batchUsers) => {
            for (const user of batchUsers) {
                insertStmt.run(user.user_id, user.offenses, user.time_added);
            }
        });

        transaction(batch);
        logger.debug(`[cas-ban] Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}`);
    }
}

module.exports = {
    init,
    syncCasBans
};
