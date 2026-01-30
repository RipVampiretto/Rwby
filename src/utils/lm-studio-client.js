/**
 * @fileoverview LM Studio API Client
 * @module utils/lm-studio-client
 *
 * Client centralizzato per interagire con LM Studio tramite API HTTP (OpenAI-compatible).
 * Sostituisce l'uso dell'SDK ufficiale per maggiore controllo e flessibilità.
 */
const axios = require('axios');
const logger = require('../middlewares/logger');
const envConfig = require('../config/env');

// Funzione helper per ottenere l'URL base HTTP
function getBaseUrl() {
    let apiUrl = envConfig.LM_STUDIO.url || 'http://localhost:1234';
    if (apiUrl.startsWith('ws://')) apiUrl = apiUrl.replace('ws://', 'http://');
    if (apiUrl.startsWith('wss://')) apiUrl = apiUrl.replace('wss://', 'https://');
    // Ensure no trailing slash
    return apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
}

/**
 * Ottiene o crea l'istanza del client Axios.
 * @returns {import('axios').AxiosInstance}
 */
function getClient() {
    const baseUrl = getBaseUrl();
    const client = axios.create({
        baseURL: baseUrl,
        timeout: 60000,
        headers: {
            'Content-Type': 'application/json'
        }
    });

    // Aggiungi interpector per logging errori
    // client.interceptors.response.use(
    //     response => response,
    //     error => {
    //         logger.error(`[lm-studio-client] Axios error: ${error.message}`);
    //         return Promise.reject(error);
    //     }
    // );
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
    const client = getClient();

    try {
        const payload = {
            model: modelId,
            messages: messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 500,
            stop: options.stop || undefined,
            stream: false
        };

        logger.debug(`[lm-studio-client] textChat request to ${modelId}, msgs: ${messages.length}`);

        const response = await client.post('/v1/chat/completions', payload, {
            timeout: options.timeout || 30000
        });

        const choice = response.data.choices?.[0];
        if (!choice) throw new Error('No choices in response');

        const elapsed = (Date.now() - startTime) / 1000;
        const usage = response.data.usage || {};

        return {
            content: choice.message.content.trim(),
            stats: {
                predictedTokensCount: usage.completion_tokens || 0,
                timeToFirstTokenSec: 0, // Not available in non-streaming std response
                totalTimeSec: elapsed,
                stopReason: choice.finish_reason || 'unknown'
            }
        };
    } catch (e) {
        logger.error(`[lm-studio-client] textChat error: ${e.message}`);
        if (e.response) {
            logger.error(`[lm-studio-client] API Response: ${JSON.stringify(e.response.data)}`);
        }
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
    const client = getClient();

    try {
        // Construct messages with image_url for OpenAI compatibility
        const messages = [
            { role: 'system', content: systemPrompt },
            {
                role: 'user',
                content: [
                    { type: 'text', text: userText },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/jpeg;base64,${base64Image}`
                        }
                    }
                ]
            }
        ];

        const payload = {
            model: modelId,
            messages: messages,
            temperature: options.temperature ?? 0.1,
            max_tokens: options.maxTokens ?? 500,
            stream: false
        };

        const response = await client.post('/v1/chat/completions', payload, {
            timeout: options.timeout || 60000
        });

        const choice = response.data.choices?.[0];
        if (!choice) throw new Error('No choices in response');

        const elapsed = (Date.now() - startTime) / 1000;
        const usage = response.data.usage || {};

        return {
            content: choice.message.content.trim(),
            stats: {
                predictedTokensCount: usage.completion_tokens || 0,
                timeToFirstTokenSec: 0,
                totalTimeSec: elapsed,
                stopReason: choice.finish_reason || 'unknown'
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
        const client = getClient();
        // Check /v1/models as health check
        const response = await client.get('/v1/models');
        const models = response.data.data || [];
        logger.debug(`[lm-studio-client] Connection OK, ${models.length} models available`);
        return true;
    } catch (e) {
        logger.error(`[lm-studio-client] Connection failed: ${e.message}`);
        return false;
    }
}

/**
 * Lista i modelli caricati in LM Studio.
 * Nota: /v1/models ritorna TUTTI i modelli disponibili, non solo quelli caricati in memoria.
 * Per sapere quelli caricati, bisognerebbe usare l'API interna, ma per ora usiamo v1/models come proxy.
 * Oppure, se LM Studio lo supporta, /api/v1/models/loaded (API interna).
 * @returns {Promise<Array>}
 */
async function listLoadedModels() {
    try {
        const client = getClient();
        // Use standard v1 endpoint compatibility
        const response = await client.get('/v1/models');
        return response.data.data || [];
    } catch (e) {
        logger.error(`[lm-studio-client] listLoadedModels error: ${e.message}`);
        return [];
    }
}

/**
 * Carica un modello specifico tramite API HTTP di LM Studio (Internal API).
 * @param {string} modelId - ID del modello da caricare
 * @param {Object} config - Configurazione opzionale (context_length, gpu_offload, etc.)
 * @returns {Promise<boolean>} Successo operazione
 */
async function loadModel(modelId, config = {}) {
    if (!modelId) return false;

    const client = getClient();
    // Internal API endpoint
    const endpoint = '/api/v1/models/load';

    logger.info(`[lm-studio-client] 🔄 Attempting to load model: ${modelId}`);

    try {
        const payload = {
            model: modelId,
            context_length: config.context_length || 8192,
            flash_attention: true,
            gpu_offload: config.gpu_offload
        };

        // Merge extra config and clean
        Object.assign(payload, config);
        Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

        const response = await client.post(endpoint, payload, {
            timeout: 60000 // 60s timeout for loading
        });

        if (response.status === 200) {
            logger.info(`[lm-studio-client] ✅ Model loaded successfully: ${modelId}`);
            return true;
        } else {
            logger.warn(`[lm-studio-client] ⚠️ Model load returned status ${response.status}: ${response.data}`);
            return false;
        }

    } catch (e) {
        if (e.response) {
            const msg = e.response.data?.error || e.response.statusText;
            if (msg && msg.toString().toLowerCase().includes('already loaded')) {
                logger.info(`[lm-studio-client] ℹ️ Model ${modelId} is already loaded.`);
                return true;
            }
            logger.error(`[lm-studio-client] ❌ Failed to load model ${modelId}: [${e.response.status}] ${JSON.stringify(e.response.data)}`);
        } else {
            logger.error(`[lm-studio-client] ❌ Network error loading model ${modelId}: ${e.message}`);
        }
        return false;
    }
}

/**
 * Carica tutti i modelli configurati nel file .env (Mascot, NSFW, Scam).
 */
async function loadAllModels() {
    logger.info('[lm-studio-client] 🚀 Starting initialization of all AI models...');

    const modelsToLoad = [
        { id: envConfig.LM_STUDIO.model, name: 'Default/Chat', config: { context_length: 24067 } },
        { id: envConfig.LM_STUDIO.nsfwModel, name: 'Vision/NSFW', config: { context_length: 38609 } },
        { id: envConfig.LM_STUDIO.scamModel, name: 'Scam Detection', config: { context_length: 38609 } },
        { id: process.env.AI_MASCOT_MODEL, name: 'Mascot Persona', config: { context_length: 24067 } }
    ];

    const uniqueModels = new Map();
    for (const m of modelsToLoad) {
        if (!m.id) continue;
        if (!uniqueModels.has(m.id)) {
            uniqueModels.set(m.id, m);
        }
    }

    if (uniqueModels.size === 0) {
        logger.warn('[lm-studio-client] No models configured to load.');
        return;
    }

    logger.info(`[lm-studio-client] Found ${uniqueModels.size} unique models to load.`);

    for (const model of uniqueModels.values()) {
        await loadModel(model.id, model.config);
    }

    logger.info('[lm-studio-client] ✅ All model loading attempts completed.');
}

module.exports = {
    textChat,
    visionChat,
    checkConnection,
    listLoadedModels,
    loadModel,
    loadAllModels
};
