#!/usr/bin/env node

/**
 * Database Migration Script: Safe Join (SQLite) → Rwby (PostgreSQL)
 * 
 * Migrates all data from the legacy Safe Join bot to the new Rwby bot.
 * 
 * Usage:
 *   node scripts/migrate-database.js [options]
 * 
 * Options:
 *   --dry-run     Preview migration without making changes
 *   --verbose     Show detailed logs
 *   --sqlite-path Path to captcha_bot.db (default: see SQLITE_PATH below)
 */

const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

// ============================================================================
// CONFIGURATION
// ============================================================================

// Default path to Safe Join's SQLite database
const SQLITE_PATH = process.env.SQLITE_PATH ||
    '/Users/ripvampiretto/Downloads/Telegram Desktop/Safe Join/captcha_bot.db';

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const PREVIEW = args.includes('--preview'); // Preview mode: SQLite only, no PG needed
const VERBOSE = args.includes('--verbose');
const customPath = args.find(a => a.startsWith('--sqlite-path='));
const sqlitePath = customPath ? customPath.split('=')[1] : SQLITE_PATH;

// PostgreSQL connection (lazy - only created when needed)
let pgPool = null;
function getPgPool() {
    if (!pgPool) {
        pgPool = new Pool({
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME || 'rwby_bot',
            user: process.env.DB_USER || 'rwby',
            password: process.env.DB_PASSWORD || 'your_secure_password_here',
        });
    }
    return pgPool;
}

// ============================================================================
// LOGGING UTILITIES
// ============================================================================

const log = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    success: (msg) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${msg}`),
    warn: (msg) => console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`),
    error: (msg) => console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`),
    verbose: (msg) => VERBOSE && console.log(`\x1b[90m[DEBUG]\x1b[0m ${msg}`),
    progress: (table, current, total) => {
        process.stdout.write(`\r  Migrating ${table}: ${current}/${total}`);
    }
};

// ============================================================================
// SQLITE HELPERS
// ============================================================================

function openSqlite() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(sqlitePath, sqlite3.OPEN_READONLY, (err) => {
            if (err) reject(err);
            else resolve(db);
        });
    });
}

function sqliteAll(db, query) {
    return new Promise((resolve, reject) => {
        db.all(query, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function closeSqlite(db) {
    return new Promise((resolve) => {
        db.close(() => resolve());
    });
}

// ============================================================================
// MIGRATION FUNCTIONS
// ============================================================================

/**
 * Migrate users_cache → users
 */
async function migrateUsers(sqliteDb, pgClient, stats) {
    log.info('Migrating users_cache → users...');

    const users = await sqliteAll(sqliteDb, 'SELECT * FROM users_cache');
    stats.users_cache = { total: users.length, migrated: 0 };

    if (users.length === 0) {
        log.warn('  No users found in users_cache');
        return;
    }

    for (let i = 0; i < users.length; i++) {
        const user = users[i];
        log.verbose(`  User: ${user.user_id} (${user.username || 'no username'})`);

        if (!DRY_RUN && !PREVIEW && pgClient) {
            await pgClient.query(`
                INSERT INTO users (user_id, username, first_name, last_name, first_seen, last_seen)
                VALUES ($1, $2, $3, $4, to_timestamp($5::bigint / 1000), to_timestamp($6::bigint / 1000))
                ON CONFLICT (user_id) DO UPDATE SET
                    username = COALESCE(EXCLUDED.username, users.username),
                    first_name = COALESCE(EXCLUDED.first_name, users.first_name),
                    last_name = COALESCE(EXCLUDED.last_name, users.last_name),
                    last_seen = GREATEST(EXCLUDED.last_seen, users.last_seen)
            `, [
                user.user_id,
                user.username,
                user.first_name,
                user.last_name,
                user.last_seen || user.last_update || Date.now(),
                user.last_seen || user.last_update || Date.now()
            ]);
        }

        stats.users_cache.migrated++;
        log.progress('users', i + 1, users.length);
    }
    console.log(); // New line after progress
    log.success(`  Migrated ${stats.users_cache.migrated}/${stats.users_cache.total} users`);
}

/**
 * Migrate global_bans → users.is_banned_global + intel_data
 */
async function migrateGlobalBans(sqliteDb, pgClient, stats) {
    log.info('Migrating global_bans → users + intel_data...');

    const bans = await sqliteAll(sqliteDb, 'SELECT * FROM global_bans');
    stats.global_bans = { total: bans.length, migrated: 0 };

    if (bans.length === 0) {
        log.warn('  No global bans found');
        return;
    }

    for (let i = 0; i < bans.length; i++) {
        const ban = bans[i];
        log.verbose(`  Ban: ${ban.user_id} - ${ban.reason}`);

        if (!DRY_RUN && !PREVIEW && pgClient) {
            // Ensure user exists and mark as globally banned
            await pgClient.query(`
                INSERT INTO users (user_id, username, first_name, is_banned_global, first_seen)
                VALUES ($1, $2, $3, TRUE, to_timestamp($4::bigint / 1000))
                ON CONFLICT (user_id) DO UPDATE SET
                    is_banned_global = TRUE,
                    username = COALESCE(EXCLUDED.username, users.username),
                    first_name = COALESCE(EXCLUDED.first_name, users.first_name)
            `, [
                ban.user_id,
                ban.user_username,
                ban.user_name,
                ban.banned_at || Date.now()
            ]);

            // Create intel_data record for the ban
            await pgClient.query(`
                INSERT INTO intel_data (type, value, metadata, added_by_user, status, created_at)
                VALUES ('global_ban', $1::text, $2::jsonb, $3, 'active', to_timestamp($4::bigint / 1000))
            `, [
                ban.user_id.toString(),
                JSON.stringify({
                    reason: ban.reason,
                    user_name: ban.user_name,
                    user_username: ban.user_username,
                    source: 'safe_join_migration'
                }),
                ban.banned_by,
                ban.banned_at || Date.now()
            ]);
        }

        stats.global_bans.migrated++;
        log.progress('global_bans', i + 1, bans.length);
    }
    console.log();
    log.success(`  Migrated ${stats.global_bans.migrated}/${stats.global_bans.total} global bans`);
}

/**
 * Migrate group_config → guild_config
 */
async function migrateGroupConfig(sqliteDb, pgClient, stats) {
    log.info('Migrating group_config → guild_config...');

    const configs = await sqliteAll(sqliteDb, 'SELECT * FROM group_config');
    stats.group_config = { total: configs.length, migrated: 0 };

    if (configs.length === 0) {
        log.warn('  No group configs found');
        return;
    }

    for (let i = 0; i < configs.length; i++) {
        const cfg = configs[i];
        log.verbose(`  Group: ${cfg.chat_id} (enabled: ${cfg.enabled}, gban: ${cfg.gbanlist_enabled})`);

        // Parse welcome_keyboard - Safe Join stores it as full inline_keyboard JSON
        let welcomeButtons = null;
        if (cfg.welcome_keyboard) {
            try {
                // Safe Join format is already: {"inline_keyboard":[[{text, url}, ...], ...]}
                const parsed = JSON.parse(cfg.welcome_keyboard);
                if (parsed.inline_keyboard) {
                    // Extract just the inline_keyboard array for Rwby format
                    welcomeButtons = JSON.stringify(parsed.inline_keyboard);
                    log.verbose(`    Parsed ${parsed.inline_keyboard.length} button rows`);
                }
            } catch (e) {
                log.warn(`    Failed to parse welcome_keyboard for ${cfg.chat_id}: ${e.message}`);
            }
        }

        if (!DRY_RUN && !PREVIEW && pgClient) {
            await pgClient.query(`
                INSERT INTO guild_config (
                    guild_id,
                    log_channel_id,
                    welcome_enabled,
                    welcome_msg_enabled,
                    welcome_message,
                    welcome_buttons,
                    captcha_enabled,
                    kick_timeout,
                    casban_enabled,
                    created_at,
                    updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, to_timestamp($10::bigint / 1000), to_timestamp($11::bigint / 1000))
                ON CONFLICT (guild_id) DO UPDATE SET
                    log_channel_id = COALESCE(EXCLUDED.log_channel_id, guild_config.log_channel_id),
                    welcome_enabled = EXCLUDED.welcome_enabled,
                    welcome_msg_enabled = EXCLUDED.welcome_msg_enabled,
                    welcome_message = COALESCE(EXCLUDED.welcome_message, guild_config.welcome_message),
                    welcome_buttons = COALESCE(EXCLUDED.welcome_buttons, guild_config.welcome_buttons),
                    captcha_enabled = EXCLUDED.captcha_enabled,
                    kick_timeout = EXCLUDED.kick_timeout,
                    casban_enabled = EXCLUDED.casban_enabled,
                    updated_at = NOW()
            `, [
                cfg.chat_id,
                cfg.log_channel_id,
                cfg.enabled === 1,                       // welcome_enabled
                cfg.welcome_text ? true : false,         // welcome_msg_enabled
                cfg.welcome_text,                        // welcome_message
                welcomeButtons,                          // welcome_buttons
                cfg.enabled === 1,                       // captcha_enabled (same as enabled)
                cfg.timeout || 5,                        // kick_timeout
                cfg.gbanlist_enabled === 1,              // casban_enabled
                cfg.created_at || Date.now(),
                cfg.updated_at || Date.now()
            ]);
        }

        stats.group_config.migrated++;
        log.progress('group_config', i + 1, configs.length);
    }
    console.log();
    log.success(`  Migrated ${stats.group_config.migrated}/${stats.group_config.total} group configs`);
}

/**
 * Migrate banned_words → word_filters
 */
async function migrateBannedWords(sqliteDb, pgClient, stats) {
    log.info('Migrating banned_words → word_filters...');

    const words = await sqliteAll(sqliteDb, 'SELECT * FROM banned_words');
    stats.banned_words = { total: words.length, migrated: 0, skipped: 0 };

    if (words.length === 0) {
        log.warn('  No banned words found');
        return;
    }

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        log.verbose(`  Word: "${word.word}"`);

        if (!DRY_RUN && !PREVIEW && pgClient) {
            // Check if already exists
            const existing = await pgClient.query(
                'SELECT id FROM word_filters WHERE guild_id = 0 AND word = $1',
                [word.word]
            );

            if (existing.rows.length > 0) {
                stats.banned_words.skipped++;
                log.verbose(`    Skipped (already exists)`);
            } else {
                await pgClient.query(`
                    INSERT INTO word_filters (guild_id, word, action, category, created_at)
                    VALUES (0, $1, 'delete', 'legacy', to_timestamp($2::bigint / 1000))
                `, [word.word, word.created_at || Date.now()]);
                stats.banned_words.migrated++;
            }
        } else {
            stats.banned_words.migrated++;
        }

        log.progress('banned_words', i + 1, words.length);
    }
    console.log();
    log.success(`  Migrated ${stats.banned_words.migrated}/${stats.banned_words.total} words (${stats.banned_words.skipped} skipped)`);
}

/**
 * Migrate link_whitelist → link_rules
 */
async function migrateLinkWhitelist(sqliteDb, pgClient, stats) {
    log.info('Migrating link_whitelist → link_rules...');

    const domains = await sqliteAll(sqliteDb, 'SELECT * FROM link_whitelist');
    stats.link_whitelist = { total: domains.length, migrated: 0, skipped: 0 };

    if (domains.length === 0) {
        log.warn('  No whitelisted domains found');
        return;
    }

    for (let i = 0; i < domains.length; i++) {
        const domain = domains[i];
        log.verbose(`  Domain: "${domain.domain}"`);

        if (!DRY_RUN && !PREVIEW && pgClient) {
            // Check if already exists
            const existing = await pgClient.query(
                'SELECT id FROM link_rules WHERE guild_id = 0 AND pattern = $1',
                [domain.domain]
            );

            if (existing.rows.length > 0) {
                stats.link_whitelist.skipped++;
                log.verbose(`    Skipped (already exists)`);
            } else {
                await pgClient.query(`
                    INSERT INTO link_rules (guild_id, pattern, type, action, category, created_at)
                    VALUES (0, $1, 'whitelist', 'allow', 'trusted', to_timestamp($2::bigint / 1000))
                `, [domain.domain, domain.created_at || Date.now()]);
                stats.link_whitelist.migrated++;
            }
        } else {
            stats.link_whitelist.migrated++;
        }

        log.progress('link_whitelist', i + 1, domains.length);
    }
    console.log();
    log.success(`  Migrated ${stats.link_whitelist.migrated}/${stats.link_whitelist.total} domains (${stats.link_whitelist.skipped} skipped)`);
}

/**
 * Migrate deleted_messages → pending_deletions (optional)
 */
async function migrateDeletedMessages(sqliteDb, pgClient, stats) {
    log.info('Migrating deleted_messages → pending_deletions...');

    const messages = await sqliteAll(sqliteDb, 'SELECT * FROM deleted_messages');
    stats.deleted_messages = { total: messages.length, migrated: 0 };

    if (messages.length === 0) {
        log.warn('  No deleted messages found');
        return;
    }

    // These are old records, likely expired - just count them
    log.warn(`  Found ${messages.length} deleted message records (skipping - likely expired)`);
    stats.deleted_messages.migrated = 0;
    stats.deleted_messages.skipped = messages.length;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║     Database Migration: Safe Join (SQLite) → Rwby (PG)       ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    if (PREVIEW) {
        log.warn('PREVIEW MODE - Reading SQLite only, no PostgreSQL connection needed\n');
    } else if (DRY_RUN) {
        log.warn('DRY RUN MODE - No changes will be made to PostgreSQL\n');
    }

    log.info(`SQLite source: ${sqlitePath}`);
    if (!PREVIEW) {
        log.info(`PostgreSQL target: ${process.env.DB_NAME || 'rwby'}@${process.env.DB_HOST || 'localhost'}\n`);
    }

    const stats = {};
    let sqliteDb;
    let pgClient;

    try {
        // Open connections
        log.info('Opening database connections...');
        sqliteDb = await openSqlite();
        log.success('  SQLite connected');

        if (!PREVIEW) {
            pgClient = await getPgPool().connect();
            log.success('  PostgreSQL connected\n');

            // Start transaction (for PostgreSQL only, not in dry-run)
            if (!DRY_RUN) {
                await pgClient.query('BEGIN');
                log.info('Transaction started\n');
            }
        } else {
            console.log();
        }

        // Run migrations (in preview mode, pgClient is null but we just count)
        await migrateUsers(sqliteDb, pgClient, stats);
        await migrateGlobalBans(sqliteDb, pgClient, stats);
        await migrateGroupConfig(sqliteDb, pgClient, stats);
        await migrateBannedWords(sqliteDb, pgClient, stats);
        await migrateLinkWhitelist(sqliteDb, pgClient, stats);
        await migrateDeletedMessages(sqliteDb, pgClient, stats);

        // Commit transaction
        if (!PREVIEW && !DRY_RUN && pgClient) {
            await pgClient.query('COMMIT');
            log.success('\nTransaction committed successfully!\n');
        }

        // Print summary
        console.log('\n╔══════════════════════════════════════════════════════════════╗');
        console.log('║                      MIGRATION SUMMARY                       ║');
        console.log('╠══════════════════════════════════════════════════════════════╣');

        for (const [table, data] of Object.entries(stats)) {
            const skipped = data.skipped ? ` (${data.skipped} skipped)` : '';
            console.log(`║  ${table.padEnd(20)} │ ${data.migrated}/${data.total}${skipped.padEnd(20)} ║`);
        }

        console.log('╚══════════════════════════════════════════════════════════════╝\n');

        if (PREVIEW) {
            log.warn('This was a PREVIEW. Run without --preview to actually migrate.\n');
        } else if (DRY_RUN) {
            log.warn('This was a DRY RUN. Run without --dry-run to apply changes.\n');
        } else {
            log.success('Migration completed successfully! 🎉\n');
        }

    } catch (error) {
        log.error(`Migration failed: ${error.message}`);
        console.error(error);

        if (pgClient && !DRY_RUN && !PREVIEW) {
            await pgClient.query('ROLLBACK');
            log.warn('Transaction rolled back');
        }

        process.exit(1);
    } finally {
        // Close connections
        if (sqliteDb) await closeSqlite(sqliteDb);
        if (pgClient) pgClient.release();
        if (pgPool) await pgPool.end();
    }
}

main();
