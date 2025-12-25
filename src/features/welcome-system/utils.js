/**
 * @fileoverview Utility functions per il modulo Welcome System
 * @module features/welcome-system/utils
 *
 * @description
 * Funzioni di utilità per la gestione del sistema di benvenuto:
 * - Parsing configurazione pulsanti dal database
 * - Sostituzione wildcards nei messaggi di benvenuto
 */

/**
 * Wildcards supportate nei messaggi di benvenuto:
 *
 * **Dati Utente:**
 * - `{mention}` - Menzione cliccabile dell'utente
 * - `{user}` - Nome dell'utente (first_name)
 * - `{username}` - @username o "-" se non presente
 * - `{first_name}` - Nome
 * - `{last_name}` - Cognome
 * - `{id}` - ID Telegram
 * - `{fullname}` - Nome completo (nome + cognome)
 *
 * **Dati Gruppo:**
 * - `{mention_group}` - Menzione cliccabile del gruppo (se pubblico)
 * - `{chat_title}` - Titolo del gruppo
 * - `{chat_username}` - @username del gruppo o "-"
 * - `{chat_id}` - ID del gruppo
 * - `{group_name}` - Alias per chat_title
 *
 * **Funzioni Speciali:**
 * - `{Testo|URL}` - Link cliccabile con testo personalizzato
 */

/**
 * Analizza la configurazione dei pulsanti dal database.
 * Supporta sia il formato JSONB diretto che stringhe JSON.
 *
 * @param {Object|Array|string|null} buttonsJson - Configurazione pulsanti dal database
 * @returns {Array<Array<{text: string, url: string}>>} Array di righe di pulsanti
 *
 * @example
 * // Input dal database (già parsato come oggetto)
 * const buttons = parseButtonConfig({
 *   inline_keyboard: [[{ text: "Link", url: "https://example.com" }]]
 * });
 * // Returns: [[{ text: "Link", url: "https://example.com" }]]
 */
function parseButtonConfig(buttonsJson) {
    if (!buttonsJson) return [];

    // Se è già parsato (JSONB arriva come oggetto da PostgreSQL)
    if (typeof buttonsJson === 'object') {
        // Potrebbe essere { inline_keyboard: [...] } o direttamente [...]
        if (buttonsJson.inline_keyboard) {
            return buttonsJson.inline_keyboard;
        }
        // Se è già in formato array
        if (Array.isArray(buttonsJson)) {
            return buttonsJson;
        }
    }

    // Fallback: prova a parsare se è una stringa
    if (typeof buttonsJson === 'string') {
        try {
            const parsed = JSON.parse(buttonsJson);
            if (parsed.inline_keyboard) return parsed.inline_keyboard;
            if (Array.isArray(parsed)) return parsed;
        } catch (e) {
            return [];
        }
    }

    return [];
}

/**
 * Sostituisce le wildcards nel testo con i dati effettivi dell'utente e del gruppo.
 *
 * @param {string} text - Testo con wildcards da sostituire
 * @param {Object} user - Oggetto utente Telegram
 * @param {number} user.id - ID utente
 * @param {string} user.first_name - Nome
 * @param {string} [user.last_name] - Cognome
 * @param {string} [user.username] - Username senza @
 * @param {Object} chat - Oggetto chat Telegram
 * @param {number} chat.id - ID chat
 * @param {string} [chat.title] - Titolo del gruppo
 * @param {string} [chat.username] - Username del gruppo senza @
 * @returns {string} Testo con wildcards sostituite
 *
 * @example
 * const text = replaceWildcards(
 *   "Benvenuto {mention} in {chat_title}!",
 *   { id: 123, first_name: "Mario" },
 *   { id: -100123, title: "Gruppo Test" }
 * );
 * // Returns: "Benvenuto <a href=\"tg://user?id=123\">Mario</a> in Gruppo Test!"
 */
function replaceWildcards(text, user, chat) {
    if (!text) return '';

    let processed = text;

    // --- Dati Utente ---
    const mention = `<a href="tg://user?id=${user.id}">${user.first_name}</a>`;
    const username = user.username ? `@${user.username}` : '-';

    processed = processed.replace(/{mention}/g, mention);
    processed = processed.replace(/{user}/g, user.first_name);
    processed = processed.replace(/{username}/g, username);
    processed = processed.replace(/{first_name}/g, user.first_name);
    processed = processed.replace(/{last_name}/g, user.last_name || '');
    processed = processed.replace(/{id}/g, user.id);

    // Supporto legacy
    processed = processed.replace(/{fullname}/g, [user.first_name, user.last_name].filter(Boolean).join(' '));

    // --- Dati Gruppo ---
    const chatTitle = chat.title || 'Group';
    const chatUsername = chat.username ? `@${chat.username}` : '-';
    const mentionGroup = chat.username
        ? `<a href="https://t.me/${chat.username}">${chatTitle}</a>`
        : `<b>${chatTitle}</b>`;

    processed = processed.replace(/{mention_group}/g, mentionGroup);
    processed = processed.replace(/{chat_title}/g, chatTitle);
    processed = processed.replace(/{chat_username}/g, chatUsername);
    processed = processed.replace(/{chat_id}/g, chat.id);
    processed = processed.replace(/{group_name}/g, chatTitle);

    // --- Funzioni Speciali ---
    // {Text|URL} -> <a href="URL">Text</a>
    processed = processed.replace(/{([^|}]+)\|([^}]+)}/g, (match, label, url) => {
        return `<a href="${url}">${label}</a>`;
    });

    return processed;
}

module.exports = {
    parseButtonConfig,
    replaceWildcards
};
