/**
 * Migration: Add preferred_language column to users table
 * Run with: node src/database/migrations/002_add_user_preferred_language.js
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

    console.log('🔄 Running migration: Add preferred_language column to users...');

    try {
        // Check if column exists
        const checkResult = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'preferred_language'
        `);

        if (checkResult.rows.length > 0) {
            console.log('✅ Column "preferred_language" already exists. Skipping.');
        } else {
            await pool.query(`
                ALTER TABLE users 
                ADD COLUMN preferred_language TEXT DEFAULT 'en'
            `);
            console.log('✅ Added column "preferred_language" to users.');
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
