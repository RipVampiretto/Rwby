const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../middlewares/logger');

// Configuration
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');
const RETENTION = {
    hourly: parseInt(process.env.BACKUP_RETENTION_HOURS) || 24,  // Keep 24 hourly backups
    daily: parseInt(process.env.BACKUP_RETENTION_DAYS) || 7,     // Keep 7 daily backups
    weekly: parseInt(process.env.BACKUP_RETENTION_WEEKS) || 4    // Keep 4 weekly backups
};

// Ensure backup directory exists
function ensureBackupDir() {
    const dirs = ['hourly', 'daily', 'weekly'].map(d => path.join(BACKUP_DIR, d));
    for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            logger.info(`[backup] Created directory: ${dir}`);
        }
    }
}

/**
 * Generate backup filename with timestamp
 */
function getBackupFilename(type) {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `rwby_${type}_${timestamp}.sql`;
}

/**
 * Run pg_dump to create backup
 */
async function runBackup(type = 'hourly') {
    ensureBackupDir();

    const filename = getBackupFilename(type);
    const filepath = path.join(BACKUP_DIR, type, filename);

    const config = {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: process.env.POSTGRES_PORT || '5432',
        db: process.env.POSTGRES_DB || 'rwby_bot',
        user: process.env.POSTGRES_USER || 'rwby',
        password: process.env.POSTGRES_PASSWORD
    };

    // pg_dump command with password via environment
    const cmd = `PGPASSWORD="${config.password}" pg_dump -h ${config.host} -p ${config.port} -U ${config.user} -d ${config.db} -F p -f "${filepath}"`;

    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                logger.error(`[backup] ${type} backup failed: ${error.message}`);
                reject(error);
                return;
            }
            if (stderr && !stderr.includes('warning')) {
                logger.warn(`[backup] ${type} stderr: ${stderr}`);
            }

            // Get file size
            const stats = fs.statSync(filepath);
            const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

            logger.info(`[backup] ${type} backup created: ${filename} (${sizeMB} MB)`);
            resolve(filepath);
        });
    });
}

/**
 * Cleanup old backups based on retention policy
 */
function cleanupOldBackups(type) {
    const dir = path.join(BACKUP_DIR, type);
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.sql'))
        .map(f => ({
            name: f,
            path: path.join(dir, f),
            time: fs.statSync(path.join(dir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time); // Newest first

    const maxFiles = RETENTION[type];
    const toDelete = files.slice(maxFiles);

    for (const file of toDelete) {
        try {
            fs.unlinkSync(file.path);
            logger.info(`[backup] Deleted old ${type} backup: ${file.name}`);
        } catch (e) {
            logger.error(`[backup] Failed to delete ${file.path}: ${e.message}`);
        }
    }
}

/**
 * Start backup scheduler
 */
function startScheduler() {
    logger.info('[backup] Starting backup scheduler');

    // Hourly backup - every hour
    setInterval(async () => {
        try {
            await runBackup('hourly');
            cleanupOldBackups('hourly');
        } catch (e) {
            logger.error(`[backup] Hourly backup error: ${e.message}`);
        }
    }, 60 * 60 * 1000); // 1 hour

    // Daily backup - every 24 hours
    setInterval(async () => {
        try {
            await runBackup('daily');
            cleanupOldBackups('daily');
        } catch (e) {
            logger.error(`[backup] Daily backup error: ${e.message}`);
        }
    }, 24 * 60 * 60 * 1000); // 24 hours

    // Weekly backup - every 7 days
    setInterval(async () => {
        try {
            await runBackup('weekly');
            cleanupOldBackups('weekly');
        } catch (e) {
            logger.error(`[backup] Weekly backup error: ${e.message}`);
        }
    }, 7 * 24 * 60 * 60 * 1000); // 7 days

    // Run initial hourly backup on start
    setTimeout(async () => {
        try {
            await runBackup('hourly');
            logger.info('[backup] Initial backup completed');
        } catch (e) {
            logger.warn(`[backup] Initial backup skipped: ${e.message}`);
        }
    }, 5000); // Wait 5 seconds after start
}

/**
 * Restore from backup file
 */
async function restoreBackup(filepath) {
    if (!fs.existsSync(filepath)) {
        throw new Error(`Backup file not found: ${filepath}`);
    }

    const config = {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: process.env.POSTGRES_PORT || '5432',
        db: process.env.POSTGRES_DB || 'rwby_bot',
        user: process.env.POSTGRES_USER || 'rwby',
        password: process.env.POSTGRES_PASSWORD
    };

    const cmd = `PGPASSWORD="${config.password}" psql -h ${config.host} -p ${config.port} -U ${config.user} -d ${config.db} -f "${filepath}"`;

    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                logger.error(`[backup] Restore failed: ${error.message}`);
                reject(error);
                return;
            }
            logger.info(`[backup] Restore completed from: ${filepath}`);
            resolve(true);
        });
    });
}

/**
 * List available backups
 */
function listBackups() {
    const result = { hourly: [], daily: [], weekly: [] };

    for (const type of ['hourly', 'daily', 'weekly']) {
        const dir = path.join(BACKUP_DIR, type);
        if (fs.existsSync(dir)) {
            result[type] = fs.readdirSync(dir)
                .filter(f => f.endsWith('.sql'))
                .map(f => {
                    const stats = fs.statSync(path.join(dir, f));
                    return {
                        name: f,
                        size: (stats.size / (1024 * 1024)).toFixed(2) + ' MB',
                        date: stats.mtime.toISOString()
                    };
                })
                .sort((a, b) => new Date(b.date) - new Date(a.date));
        }
    }

    return result;
}

module.exports = {
    runBackup,
    cleanupOldBackups,
    startScheduler,
    restoreBackup,
    listBackups
};
