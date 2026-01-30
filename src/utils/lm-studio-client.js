/**
 * @fileoverview LM Studio SDK Client
 * @module utils/lm-studio-client
 * 
 * Client centralizzato per interagire con LM Studio tramite SDK ufficiale.
 */
const { LMStudioClient } = require('@lmstudio/sdk');
const logger = require('../middlewares/logger');
const envConfig = require('../config/env');
const axios = require('axios');

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

/**
 * Carica un modello specifico tramite API HTTP di LM Studio.
 * @param {string} modelId - ID del modello da caricare
 * @param {Object} config - Configurazione opzionale (context_length, gpu_offload, etc.)
 * @returns {Promise<boolean>} Successo operazione
 */
async function loadModel(modelId, config = {}) {
    if (!modelId) return false;

    // Convert WS URL to HTTP for API calls
    let apiUrl = envConfig.LM_STUDIO.url || 'http://localhost:1234';
    if (apiUrl.startsWith('ws://')) apiUrl = apiUrl.replace('ws://', 'http://');
    if (apiUrl.startsWith('wss://')) apiUrl = apiUrl.replace('wss://', 'https://');

    // Endpoint: /api/v1/models/load
    const endpoint = `${apiUrl}/api/v1/models/load`;

    logger.info(`[lm-studio-client] 🔄 Attempting to load model: ${modelId}`);

    try {
        const payload = {
            model: modelId,
            context_length: config.context_length || 8192,
            flash_attention: true, // Default enabled as per example
            gpu_offload: config.gpu_offload // Optional
        };

        // Merge extra config
        Object.assign(payload, config);

        // Remove undefined keys
        Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

        const response = await axios.post(endpoint, payload, {
            headers: { 'Content-Type': 'application/json' },
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
            // 400 likely means already loaded or invalid param, check message
            const msg = e.response.data?.error || e.response.statusText;
            // If already loaded, treat as success but log it
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
 * Priorità di caricamento sequenziale.
 */
async function loadAllModels() {
    logger.info('[lm-studio-client] 🚀 Starting initialization of all AI models...');

    const modelsToLoad = [
        { id: envConfig.LM_STUDIO.model, name: 'Default/Chat', config: { context_length: 24067 } },
        { id: envConfig.LM_STUDIO.nsfwModel, name: 'Vision/NSFW', config: { context_length: 38609 } },
        { id: envConfig.LM_STUDIO.scamModel, name: 'Scam Detection', config: { context_length: 38609 } },
        { id: process.env.AI_MASCOT_MODEL, name: 'Mascot Persona', config: { context_length: 24067 } }
    ];

    // Filter unique valid models
    // Handle duplicates: if a model ID is repeated (e.g. scamModel == model), pick the one with the larger context or just the first one?
    // Let's use a Map to dedup by ID, keeping the specific config if possible.
    const uniqueModels = new Map();

    for (const m of modelsToLoad) {
        if (!m.id) continue;
        if (!uniqueModels.has(m.id)) {
            uniqueModels.set(m.id, m);
        } else {
            // If already exists, maybe update max context? 
            // For now, first wins, or explicit override logic.
            // SCAM usually is same as TEXT model, so let's ensure we use the specialized config if they differ?
            // Actually, if SCAM (38k) uses same model as GENERIC (24k), we can't load the SAME model twice with different configs in LM studio easily?
            // LM Studio 0.3.x allows multi-loading but usually distinct models. If same model ID, it might just reuse.
            // Let's assume they are different or just use the config of the current entry.
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
    getClient,
    textChat,
    visionChat,
    checkConnection,
    listLoadedModels,
    loadModel,
    loadAllModels
};
