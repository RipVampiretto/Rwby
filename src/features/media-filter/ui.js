/**
 * @fileoverview Interfaccia utente per la configurazione del modulo Media Filter
 * @module features/media-filter/ui
 *
 * @description
 * Gestisce la generazione delle interfacce inline per la configurazione
 * del filtro media NSFW. Include:
 *
 * - Menu principale con stato, azione e toggle tipi media
 * - Sottomenu categorie con tutte le categorie bloccabili
 * - Gestione pulsanti dinamici in base allo stato
 *
 * @requires ../../utils/error-handlers - Per safeEdit
 * @requires ../../i18n - Per le traduzioni
 * @requires ./logic - Per le categorie NSFW
 */

const { safeEdit } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');
const i18n = require('../../i18n');
const { NSFW_CATEGORIES, getDefaultBlockedCategories } = require('./logic');

/**
 * Mostra l'interfaccia principale di configurazione del modulo Media Filter.
 * Visualizza stato, azione corrente, toggle per tipi media e accesso alle categorie.
 *
 * @param {import('grammy').Context} ctx - Contesto grammY della richiesta
 * @param {Object} db - Istanza del database
 * @param {boolean} [isEdit=false] - Se true, modifica il messaggio esistente
 * @param {boolean} [fromSettings=false] - Se true, mostra pulsante "Indietro" verso settings
 * @returns {Promise<void>}
 */
async function sendConfigUI(ctx, db, isEdit = false, fromSettings = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    logger.debug(
        `[media-monitor] sendConfigUI called - isEdit: ${isEdit}, fromSettings: ${fromSettings}, chatId: ${guildId}`
    );

    try {
        const config = await db.fetchGuildConfig(guildId);
        const enabled = config.media_enabled ? t('common.on') : t('common.off');

        // Solo DELETE o REPORT - niente BAN
        const action = config.media_action === 'report_only' ? t('common.actions.report') : t('common.actions.delete');

        // Toggle per tipi media
        const p = config.media_check_photos ? '✅' : '❌';
        const v = config.media_check_videos ? '✅' : '❌';
        const g = config.media_check_gifs ? '✅' : '❌';
        const s = config.media_check_stickers ? '✅' : '❌';

        // Conta categorie bloccate
        let blockedCategories = config.media_blocked_categories;
        if (!blockedCategories || !Array.isArray(blockedCategories)) {
            try {
                blockedCategories =
                    typeof blockedCategories === 'string'
                        ? JSON.parse(blockedCategories)
                        : getDefaultBlockedCategories();
            } catch (e) {
                blockedCategories = getDefaultBlockedCategories();
            }
        }
        const blockedCount = blockedCategories.length;

        // Parse log events
        let logEvents = {};
        if (config.log_events) {
            if (typeof config.log_events === 'string') {
                try {
                    logEvents = JSON.parse(config.log_events);
                } catch (e) {}
            } else if (typeof config.log_events === 'object') {
                logEvents = config.log_events;
            }
        }
        const logDel = logEvents['media_delete'] ? t('common.on') : t('common.off');

        let text = `${t('media.title')}\n\n` + `${t('media.description')}\n\n` + `${t('media.status')}: ${enabled}`;

        // Mostra dettagli solo quando abilitato
        if (config.media_enabled) {
            text += `\n${t('media.action')}: ${action}`;
            text += `\n${t('media.check_types')}: 📷${p} 📹${v} 🎬${g} 🪙${s}`;
            text += `\n🚫 ${t('media.blocked_categories')}: ${blockedCount}`;

            // Avviso se action è report_only ma non c'è gruppo staff
            if (config.media_action === 'report_only' && !config.staff_group_id) {
                text += `\n${t('common.warnings.no_staff_group')}`;
            }
        }

        const closeBtn = fromSettings
            ? { text: t('common.back'), callback_data: 'settings_main' }
            : { text: t('common.close'), callback_data: 'nsf_close' };

        // Costruisci tastiera dinamicamente
        const rows = [];
        rows.push([{ text: `${t('media.buttons.monitor')}: ${enabled}`, callback_data: 'nsf_toggle' }]);

        // Mostra opzioni solo quando abilitato
        if (config.media_enabled) {
            rows.push([{ text: `${t('media.buttons.action')}: ${action}`, callback_data: 'nsf_act' }]);
            rows.push([
                { text: `📷 ${p}`, callback_data: 'nsf_tog_photo' },
                { text: `📹 ${v}`, callback_data: 'nsf_tog_video' },
                { text: `🎬 ${g}`, callback_data: 'nsf_tog_gif' },
                { text: `🪙 ${s}`, callback_data: 'nsf_tog_sticker' }
            ]);
            rows.push([
                { text: `${t('media.buttons.categories')} (${blockedCount})`, callback_data: 'nsf_categories' }
            ]);
            rows.push([{ text: `${t('media.buttons.notify')}: ${logDel}`, callback_data: 'nsf_log_delete' }]);
        }

        rows.push([closeBtn]);

        const keyboard = { inline_keyboard: rows };

        if (isEdit) {
            await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'HTML' }, 'media-monitor');
        } else {
            await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
        }
    } catch (e) {
        logger.error(`[media-monitor] sendConfigUI error: ${e.message}`);
        try {
            await ctx.answerCallbackQuery(`Error: ${e.message.substring(0, 50)}`);
        } catch (e2) {}
    }
}

/**
 * Mostra il sottomenu di configurazione delle categorie NSFW.
 * Permette di abilitare/disabilitare le singole categorie di contenuti bloccati.
 *
 * Ogni categoria mostra:
 * - 🔒 se sempre bloccata (es. minors)
 * - ✅ se attualmente bloccata
 * - Nessuna icona se consentita
 *
 * @param {import('grammy').Context} ctx - Contesto grammY della richiesta
 * @param {Object} db - Istanza del database
 * @param {boolean} [fromSettings=false] - Se true, il pulsante "Indietro" torna a settings
 * @returns {Promise<void>}
 */
async function sendCategoriesUI(ctx, db, fromSettings = false) {
    const guildId = ctx.chat.id;
    const lang = await i18n.getLanguage(guildId);
    const t = (key, params) => i18n.t(lang, key, params);

    const config = await db.fetchGuildConfig(guildId);

    // Recupera categorie bloccate
    let blockedCategories = config.media_blocked_categories;
    if (!blockedCategories || !Array.isArray(blockedCategories)) {
        try {
            blockedCategories =
                typeof blockedCategories === 'string' ? JSON.parse(blockedCategories) : getDefaultBlockedCategories();
        } catch (e) {
            blockedCategories = getDefaultBlockedCategories();
        }
    }

    // Costruisci testo
    let text = `${t('media.categories_ui.title')}\n\n`;
    text += `${t('media.categories_ui.subtitle')}\n\n`;
    text += `${t('media.categories_ui.legend_title')}\n`;
    text += `${t('media.categories_ui.legend_blocked')}\n`;
    text += `${t('media.categories_ui.legend_always')}\n`;

    // Costruisci tastiera - una riga per categoria
    const keyboard = { inline_keyboard: [] };

    for (const [catId, catInfo] of Object.entries(NSFW_CATEGORIES)) {
        if (catId === 'safe') continue;

        const isBlocked = blockedCategories.includes(catId);
        const isAlwaysBlocked = catInfo.alwaysBlocked === true;
        const canToggle = catInfo.blockable !== false && !isAlwaysBlocked;

        // Nome localizzato della categoria
        const catName = t(`media.categories.${catId}.name`);

        let statusIcon;
        if (isAlwaysBlocked) {
            statusIcon = '🔒';
        } else if (isBlocked) {
            statusIcon = '✅';
        } else {
            statusIcon = '';
        }

        const btnText = statusIcon ? `${statusIcon} ${catName}` : catName;

        if (canToggle) {
            keyboard.inline_keyboard.push([{ text: btnText, callback_data: `nsf_cat_${catId}` }]);
        } else {
            keyboard.inline_keyboard.push([{ text: btnText, callback_data: `nsf_noop` }]);
        }
    }

    // Pulsante indietro
    keyboard.inline_keyboard.push([
        { text: t('media.categories_ui.back'), callback_data: fromSettings ? 'nsf_back_settings' : 'nsf_back' }
    ]);

    try {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'HTML' }, 'media-monitor');
    } catch (e) {
        logger.error(`[media-monitor] sendCategoriesUI error: ${e.message}`);
    }
}

module.exports = {
    sendConfigUI,
    sendCategoriesUI,
    NSFW_CATEGORIES
};
