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
 */
function addMessage(guildId, messageData) {
    if (!buffers.has(guildId)) {
        buffers.set(guildId, []);
    }

    const history = buffers.get(guildId);

    // Aggiungi nuovo messaggio
    history.push({
        ...messageData,
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
 * @returns {string} Stringa formattata "User: Message\n..."
 */
function getFormattedHistory(guildId) {
    const history = buffers.get(guildId) || [];
    return history
        .map(msg => `${msg.username}: ${msg.text}`)
        .join('\n');
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
