/**
 * Environment Variables Configuration
 * All variables are REQUIRED - the bot will not start without them
 */

// =============================================================================
// REQUIRED ENVIRONMENT VARIABLES
// =============================================================================

const REQUIRED_VARS = [
    // Telegram
    'BOT_TOKEN',
    'SUPER_ADMIN_IDS',
    'PARLIAMENT_CHAT_ID',

    // PostgreSQL Database
    'POSTGRES_HOST',
    'POSTGRES_PORT',
    'POSTGRES_DB',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',

    // LM Studio AI Configuration
    'LM_STUDIO_URL',
    'LM_STUDIO_MODEL',
    'LM_STUDIO_NSFW_MODEL',

    // AI Timeouts (milliseconds)
    'AI_TIMEOUT_TEXT',
    'AI_TIMEOUT_VISION',
    'AI_TIMEOUT_HEALTH_CHECK',

    // Backup Configuration
    'BACKUP_DIR',
    'BACKUP_RETENTION_HOURS',
    'BACKUP_RETENTION_DAYS',
    'BACKUP_RETENTION_WEEKS'
];

// Validate all required variables
const missing = REQUIRED_VARS.filter(key => !process.env[key]);
if (missing.length > 0) {
    console.error('\n❌ FATAL: Missing required environment variables:\n');
    missing.forEach(key => console.error(`   • ${key}`));
    console.error('\n📄 Please copy .env.example to .env and fill in all values.\n');
    process.exit(1);
}

// =============================================================================
// PARSED CONFIGURATION EXPORT
// =============================================================================

const config = {
    // Telegram Bot
    BOT_TOKEN: process.env.BOT_TOKEN,

    SUPER_ADMIN_IDS: process.env.SUPER_ADMIN_IDS.split(',')
        .map(id => parseInt(id.trim()))
        .filter(id => !isNaN(id)),

    PARLIAMENT_CHAT_ID: parseInt(process.env.PARLIAMENT_CHAT_ID),

    // Local Telegram API Server (optional)
    LOCAL_API_SERVER: process.env.LOCAL_API_SERVER || null,

    // PostgreSQL Database
    POSTGRES: {
        host: process.env.POSTGRES_HOST,
        port: parseInt(process.env.POSTGRES_PORT),
        database: process.env.POSTGRES_DB,
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD
    },

    // LM Studio AI
    LM_STUDIO: {
        url: process.env.LM_STUDIO_URL,
        model: process.env.LM_STUDIO_MODEL,
        nsfwModel: process.env.LM_STUDIO_NSFW_MODEL
    },

    // AI Timeouts (in milliseconds)
    AI_TIMEOUTS: {
        text: parseInt(process.env.AI_TIMEOUT_TEXT),
        vision: parseInt(process.env.AI_TIMEOUT_VISION),
        healthCheck: parseInt(process.env.AI_TIMEOUT_HEALTH_CHECK)
    },

    // Backup Configuration
    BACKUP: {
        dir: process.env.BACKUP_DIR,
        retentionHours: parseInt(process.env.BACKUP_RETENTION_HOURS),
        retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS),
        retentionWeeks: parseInt(process.env.BACKUP_RETENTION_WEEKS)
    }
};

// Validate parsed values
if (config.SUPER_ADMIN_IDS.length === 0) {
    console.error('❌ FATAL: SUPER_ADMIN_IDS must contain at least one valid user ID');
    process.exit(1);
}

if (isNaN(config.PARLIAMENT_CHAT_ID)) {
    console.error('❌ FATAL: PARLIAMENT_CHAT_ID must be a valid chat ID number');
    process.exit(1);
}

module.exports = config;
