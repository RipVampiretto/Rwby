/**
 * @fileoverview Repository per la gestione della configurazione gruppi
 * @module database/repos/guild
 *
 * @description
 * Fornisce funzioni per la gestione della configurazione dei gruppi.
 * Ogni gruppo ha la propria configurazione salvata nella tabella guild_config.
 *
 * @requires ../connection
 * @requires ../../middlewares/logger
 */

const { queryOne, query, queryAll } = require('../connection');
const logger = require('../../middlewares/logger');

/**
 * Nomi colonna validi per la tabella guild_config (whitelist anti SQL injection).
 * @constant {Set<string>}
 */
const GUILD_CONFIG_COLUMNS = new Set([
    // Staff Coordination
    'guild_name',
    'staff_group_id',
    'staff_topics',
    // Action Log
    'log_channel_id',
    'log_events',
    // Edit Monitor
    'edit_monitor_enabled',
    'edit_action',
    'edit_grace_period',
    // Word Filter
    'keyword_enabled',
    'keyword_sync_global',
    // Language Filter
    'lang_enabled',
    'allowed_languages',
    'lang_action',
    // Link Filter
    'link_enabled',
    'link_sync_global',
    // Media Filter
    'media_enabled',
    'media_action',
    'media_check_photos',
    'media_check_videos',
    'media_check_gifs',
    'media_check_stickers',
    'media_frame_interval',
    'media_blocked_categories',
    // Report System
    'report_enabled',
    'report_threshold',
    'report_duration',
    'report_initiator_tier',
    'report_voter_tier',
    'report_mode',
    'report_action_scam',
    'report_action_nsfw',
    'report_action_hate',
    // Spam Patterns
    'spam_patterns_enabled',
    'spam_patterns_action',
    'spam_patterns_sync_global',
    // Global Blacklist
    'blacklist_enabled',
    'blacklist_notify',
    // Welcome & Captcha System
    'welcome_enabled',
    'welcome_msg_enabled',
    'welcome_message',
    'welcome_buttons',
    'captcha_enabled',
    'captcha_mode',
    'captcha_timeout',
    'welcome_autodelete_timer',
    'rules_enabled',
    'rules_link',
    'captcha_logs_enabled',
    // Mention Filter
    'mention_filter_enabled',
    'mention_filter_action',
    'mention_filter_notify',
    // UI Language
    'ui_language'
]);

/**
 * Valori di default per nuovi gruppi (tutto disabilitato).
 * @constant {Object}
 */
const DEFAULT_CONFIG = {
    edit_monitor_enabled: false,
    keyword_enabled: false,
    lang_enabled: false,
    link_enabled: false,
    media_enabled: false,
    media_check_photos: false,
    media_check_videos: false,
    media_check_gifs: false,
    media_check_stickers: false,
    media_blocked_categories: ['minors'],
    report_enabled: false,
    spam_patterns_enabled: false,
    blacklist_enabled: false,
    welcome_enabled: false,
    captcha_enabled: false,
    rules_enabled: false,
    welcome_msg_enabled: false
};

/**
 * Ottiene la configurazione di un gruppo.
 * Legge SEMPRE dal database (nessuna cache).
 *
 * @param {number|string} guildId - ID del gruppo
 * @returns {Promise<Object>} Oggetto configurazione
 */
async function getGuildConfig(guildId) {
    try {
        let config = await queryOne('SELECT * FROM guild_config WHERE guild_id = $1', [guildId]);
        if (!config) {
            // Crea nuova config se non esiste
            await query('INSERT INTO guild_config (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [guildId]);
            config = await queryOne('SELECT * FROM guild_config WHERE guild_id = $1', [guildId]);
        }
        return config || { guild_id: guildId, ...DEFAULT_CONFIG };
    } catch (e) {
        logger.error(`[database] Failed to get guild config for ${guildId}: ${e.message}`);
        return { guild_id: guildId, ...DEFAULT_CONFIG };
    }
}

/**
 * Aggiorna la configurazione di un gruppo.
 * Include protezione contro SQL injection tramite whitelist colonne.
 *
 * @param {number} guildId - ID del gruppo
 * @param {Object} updates - Oggetto con coppie colonna:valore da aggiornare
 * @returns {Promise<void>}
 */
async function updateGuildConfig(guildId, updates) {
    // Filtra solo nomi colonna validi (protezione SQL injection)
    const validKeys = Object.keys(updates).filter(k => GUILD_CONFIG_COLUMNS.has(k));

    if (validKeys.length === 0) {
        logger.warn(`[database] updateGuildConfig called with no valid columns: ${Object.keys(updates).join(', ')}`);
        return;
    }

    // Log se alcune chiavi sono state filtrate
    const invalidKeys = Object.keys(updates).filter(k => !GUILD_CONFIG_COLUMNS.has(k));
    if (invalidKeys.length > 0) {
        logger.warn(`[database] updateGuildConfig ignored invalid columns: ${invalidKeys.join(', ')}`);
    }

    // Assicura che il gruppo esista
    await query('INSERT INTO guild_config (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [guildId]);

    // Colonne booleane (necessitano conversione 0/1 -> true/false)
    const BOOLEAN_COLUMNS = new Set([
        'edit_monitor_enabled',
        'keyword_enabled',
        'keyword_sync_global',
        'lang_enabled',
        'link_enabled',
        'link_sync_global',
        'media_enabled',
        'media_check_photos',
        'media_check_videos',
        'media_check_gifs',
        'media_check_stickers',
        'report_enabled',
        'spam_patterns_enabled',
        'spam_patterns_sync_global',
        'blacklist_enabled',
        'blacklist_notify',
        'welcome_enabled',
        'welcome_msg_enabled',
        'captcha_enabled',
        'rules_enabled',
        'captcha_logs_enabled',
        'mention_filter_enabled',
        'mention_filter_notify'
    ]);

    // Costruisce query parametrizzata
    const setClauses = validKeys.map((k, i) => `${k} = $${i + 1}`);
    const values = validKeys.map(k => {
        let val = updates[k];
        // Converti 0/1 a boolean per colonne BOOLEAN
        if (BOOLEAN_COLUMNS.has(k)) {
            val = val === 1 || val === true || val === '1' || val === 'true';
        }
        // Converti array/oggetti a JSON per colonne JSONB
        if (typeof val === 'object' && val !== null) {
            return JSON.stringify(val);
        }
        return val;
    });
    values.push(guildId);

    const sql = `UPDATE guild_config SET ${setClauses.join(', ')}, updated_at = NOW() WHERE guild_id = $${values.length}`;

    logger.debug(`[database] updateGuildConfig SQL: ${sql}`);
    logger.debug(`[database] updateGuildConfig values: ${JSON.stringify(values)}`);

    await query(sql, values);

    logger.info(`[database] updateGuildConfig completed for guild ${guildId}`);
}

/**
 * Assicura che un gruppo esista e aggiorna il nome.
 *
 * @param {Object} chat - Oggetto chat Telegram
 * @param {number} chat.id - ID chat
 * @param {string} chat.title - Titolo chat
 * @returns {Promise<boolean>} True se è stato appena creato
 */
async function upsertGuild(chat) {
    const { id, title } = chat;
    if (!title) return false; // Deve avere un titolo se è gruppo/supergruppo

    const result = await queryOne(
        `
        INSERT INTO guild_config (guild_id, guild_name) VALUES ($1, $2)
        ON CONFLICT (guild_id) DO UPDATE SET 
            guild_name = EXCLUDED.guild_name,
            updated_at = NOW()
        RETURNING created_at, updated_at
    `,
        [id, title]
    );

    // Se created_at == updated_at, significa che è stato appena inserito
    return result && result.created_at.getTime() === result.updated_at.getTime();
}

/**
 * Alias per retrocompatibilità.
 * @see getGuildConfig
 */
const fetchGuildConfig = getGuildConfig;

module.exports = {
    getGuildConfig,
    fetchGuildConfig,
    updateGuildConfig,
    upsertGuild
};
