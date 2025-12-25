/**
 * Migration: Add hidden column to spam_patterns
 * Run with: node src/database/migrations/001_add_hidden_to_spam_patterns.js
 */

const { Pool } = require('pg');
require('dotenv').config();

async function migrate() {
    const dbConfig = process.env.DATABASE_URL
        ? {
              connectionString: process.env.DATABASE_URL,
              ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
          }
        : {
              host: process.env.POSTGRES_HOST || 'localhost',
              port: parseInt(process.env.POSTGRES_PORT) || 5433,
              database: process.env.POSTGRES_DB || 'rwby_bot',
              user: process.env.POSTGRES_USER || 'rwby',
              password: process.env.POSTGRES_PASSWORD || 'rwby_secure_password'
          };

    const pool = new Pool(dbConfig);

    console.log('🔄 Running migration: Add hidden column to spam_patterns...');

    try {
        // Check if column exists
        const checkResult = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'spam_patterns' AND column_name = 'hidden'
        `);

        if (checkResult.rows.length > 0) {
            console.log('✅ Column "hidden" already exists. Skipping.');
        } else {
            await pool.query(`
                ALTER TABLE spam_patterns 
                ADD COLUMN hidden BOOLEAN DEFAULT FALSE
            `);
            console.log('✅ Added column "hidden" to spam_patterns.');
        }

        console.log('🎉 Migration completed successfully!');
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
