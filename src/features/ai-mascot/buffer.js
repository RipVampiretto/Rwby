/**
 * @fileoverview Buffer circolare per il contesto della mascotte AI
 * @module features/ai-mascot/buffer
 */

/**
 * Buffer in-memory per gli ultimi N messaggi di ogni gruppo.
 * Struttura: { guildId: [ { user, text, date }, ... ] }
 */
const buffers = new Map();

const MAX_HISTORY = 30;

/**
 * Aggiunge un messaggio al buffer del gruppo.
 * 
 * @param {number} guildId - ID del gruppo Telegram
 * @param {Object} messageData - Oggetto messaggio
 * @param {string} messageData.username - Nome utente (o first_name)
 * @param {string} messageData.text - Testo del messaggio
 * @param {number} messageData.userId - ID utente (per evitare di rispondersi da soli se serve)
 * @param {Object} [messageData.replyTo] - Dati della risposta (opzionale)
 * @param {string} messageData.replyTo.username - Username destinatario
 * @param {string} messageData.replyTo.text - Snippet testo destinatario
 */
function addMessage(guildId, messageData) {
    if (!buffers.has(guildId)) {
        buffers.set(guildId, []);
    }

    const history = buffers.get(guildId);

    // Formatta la data: [DD/MM/YYYY HH:MM]
    const now = new Date();
    const dateStr = `[${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}]`;

    // Aggiungi nuovo messaggio
    history.push({
        ...messageData,
        dateStr,
        timestamp: Date.now()
    });

    // Mantieni solo gli ultimi MAX_HISTORY
    if (history.length > MAX_HISTORY) {
        history.shift(); // Rimuovi il più vecchio
    }
}

/**
 * Ottiene la cronologia formattata per il prompt AI.
 * 
 * @param {number} guildId - ID del gruppo
 * @returns {string} Stringa formattata stile Telegram export plain text
 */
function getFormattedHistory(guildId) {
    const history = buffers.get(guildId) || [];
    return history
        .map(msg => {
            // Estrai solo HH:MM dal timestamp formattato o rigeneralo
            const timeMatch = msg.dateStr.match(/(\d{2}:\d{2})/);
            const time = timeMatch ? timeMatch[1] : '00:00';

            let line = `**[${time}] ${msg.username}:**\n`;
            if (msg.replyTo) {
                line += `> in reply to ${msg.replyTo.username}: "${msg.replyTo.text}"\n`;
            }
            line += `${msg.text}`;
            return line;
        })
        .join('\n\n');
}

/**
 * Pulisce la cronologia di un gruppo (utile per debug o reset manuale).
 */
function clearHistory(guildId) {
    buffers.delete(guildId);
}

module.exports = {
    addMessage,
    getFormattedHistory,
    clearHistory,
    MAX_HISTORY
};
