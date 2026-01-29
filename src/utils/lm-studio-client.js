/**
 * @fileoverview LM Studio SDK Client
 * @module utils/lm-studio-client
 * 
 * Client centralizzato per interagire con LM Studio tramite SDK ufficiale.
 */
const { LMStudioClient } = require('@lmstudio/sdk');
const logger = require('../middlewares/logger');
const envConfig = require('../config/env');

let client = null;

/**
 * Ottiene o crea l'istanza del client LM Studio.
 * @returns {LMStudioClient}
 */
function getClient() {
    if (!client) {
        let baseUrl = envConfig.LM_STUDIO.url || 'ws://localhost:1234';

        // L'SDK richiede ws:// o wss://
        if (baseUrl.startsWith('http://')) {
            baseUrl = baseUrl.replace('http://', 'ws://');
        } else if (baseUrl.startsWith('https://')) {
            baseUrl = baseUrl.replace('https://', 'wss://');
        }

        logger.debug(`[lm-studio-client] Creating client with baseUrl: ${baseUrl}`);
        client = new LMStudioClient({ baseUrl });
    }
    return client;
}

/**
 * Esegue una chat testuale con un modello LLM.
 * @param {string} modelId - ID del modello da usare
 * @param {Array} messages - Array di messaggi [{role, content}]
 * @param {Object} options - Opzioni di inferenza
 * @param {number} [options.temperature=0.7] - Temperatura
 * @param {number} [options.maxTokens=500] - Max tokens
 * @param {string[]} [options.stop=[]] - Stop sequences
 * @param {number} [options.timeout=30000] - Timeout in ms
 * @returns {Promise<{content: string, stats: Object}>}
 */
async function textChat(modelId, messages, options = {}) {
    const startTime = Date.now();

    try {
        const model = await getClient().llm.model(modelId);

        const prediction = model.respond(messages, {
            temperature: options.temperature ?? 0.7,
            maxTokens: options.maxTokens ?? 500,
            stopStrings: options.stop || []
        });

        // Collect full response
        let content = '';
        for await (const fragment of prediction) {
            content += fragment.content;
        }

        const result = await prediction.result();
        const elapsed = Date.now() - startTime;

        logger.debug(`[lm-studio-client] textChat completed in ${elapsed}ms`);

        return {
            content: content.trim(),
            stats: {
                predictedTokensCount: result.stats?.predictedTokensCount || 0,
                timeToFirstTokenSec: result.stats?.timeToFirstTokenSec || 0,
                totalTimeSec: elapsed / 1000,
                stopReason: result.stats?.stopReason || 'unknown'
            }
        };
    } catch (e) {
        logger.error(`[lm-studio-client] textChat error: ${e.message}`);
        throw e;
    }
}

/**
 * Esegue una chat vision (multimodale) con un modello VLM.
 * @param {string} modelId - ID del modello vision da usare
 * @param {string} systemPrompt - System prompt
 * @param {string} userText - Testo utente
 * @param {string} base64Image - Immagine in base64
 * @param {Object} options - Opzioni di inferenza
 * @param {number} [options.temperature=0.1] - Temperatura
 * @param {number} [options.maxTokens=500] - Max tokens
 * @param {number} [options.timeout=60000] - Timeout in ms
 * @returns {Promise<{content: string, stats: Object}>}
 */
async function visionChat(modelId, systemPrompt, userText, base64Image, options = {}) {
    const startTime = Date.now();

    try {
        const model = await getClient().llm.model(modelId);

        const messages = [
            { role: 'system', content: systemPrompt },
            {
                role: 'user',
                content: [
                    { type: 'text', text: userText },
                    { type: 'imageBase64', base64: base64Image }
                ]
            }
        ];

        const prediction = model.respond(messages, {
            temperature: options.temperature ?? 0.1,
            maxTokens: options.maxTokens ?? 500
        });

        // Collect full response
        let content = '';
        for await (const fragment of prediction) {
            content += fragment.content;
        }

        const result = await prediction.result();
        const elapsed = Date.now() - startTime;

        logger.debug(`[lm-studio-client] visionChat completed in ${elapsed}ms`);

        return {
            content: content.trim(),
            stats: {
                predictedTokensCount: result.stats?.predictedTokensCount || 0,
                timeToFirstTokenSec: result.stats?.timeToFirstTokenSec || 0,
                totalTimeSec: elapsed / 1000,
                stopReason: result.stats?.stopReason || 'unknown'
            }
        };
    } catch (e) {
        logger.error(`[lm-studio-client] visionChat error: ${e.message}`);
        throw e;
    }
}

/**
 * Verifica la connessione a LM Studio.
 * @returns {Promise<boolean>}
 */
async function checkConnection() {
    try {
        const models = await getClient().llm.listLoaded();
        logger.debug(`[lm-studio-client] Connection OK, ${models.length} models loaded`);
        return true;
    } catch (e) {
        logger.error(`[lm-studio-client] Connection failed: ${e.message}`);
        return false;
    }
}

/**
 * Lista i modelli caricati in LM Studio.
 * @returns {Promise<Array>}
 */
async function listLoadedModels() {
    try {
        return await getClient().llm.listLoaded();
    } catch (e) {
        logger.error(`[lm-studio-client] listLoadedModels error: ${e.message}`);
        return [];
    }
}

module.exports = {
    getClient,
    textChat,
    visionChat,
    checkConnection,
    listLoadedModels
};
