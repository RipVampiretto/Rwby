/**
 * @fileoverview Utility per salvare conversazioni AI nel formato LM Studio
 * @module utils/lm-studio-logger
 *
 * @description
 * Salva automaticamente le conversazioni AI nel formato compatibile con LM Studio.
 * Le conversazioni sono organizzate per istanza bot (rwby/safejoin).
 *
 * Variabili ambiente richieste:
 * - LM_STUDIO_CONVERSATIONS_DIR: Path base delle conversazioni
 * - LM_STUDIO_USER_FILES_DIR: Path base per i file utente (immagini)
 *
 * Se non configurate, il salvataggio è disabilitato silenziosamente.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../middlewares/logger');
const { getInstance } = require('./feature-flags');

// Base paths from env
const BASE_CONVERSATIONS_DIR = process.env.LM_STUDIO_CONVERSATIONS_DIR || null;
const BASE_USER_FILES_DIR = process.env.LM_STUDIO_USER_FILES_DIR || null;

/**
 * Verifica se il logging è abilitato.
 * @returns {boolean}
 */
function isEnabled() {
    return !!(BASE_CONVERSATIONS_DIR && BASE_USER_FILES_DIR);
}

/**
 * Ottiene il path delle conversazioni per l'istanza corrente.
 * @returns {string|null}
 */
function getConversationsDir() {
    if (!BASE_CONVERSATIONS_DIR) return null;
    return path.join(BASE_CONVERSATIONS_DIR, getInstance());
}

/**
 * Ottiene il path dei file utente.
 * @returns {string|null}
 */
function getUserFilesDir() {
    if (!BASE_USER_FILES_DIR) return null;
    return BASE_USER_FILES_DIR;
}

/**
 * Assicura che una directory esista.
 * @param {string} dir - Path directory
 */
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Salva una conversazione testuale (senza immagini).
 *
 * @param {string|number|null} chatId - ID chat Telegram (o null per generare timestamp)
 * @param {string} systemPrompt - System prompt
 * @param {string} userMessage - Messaggio utente
 * @param {string} responseText - Risposta del modello
 * @param {Object} stats - Statistiche risposta
 * @param {Object} metadata - Metadati aggiuntivi (source, model, etc.)
 */
function saveTextConversation(chatId, systemPrompt, userMessage, responseText, stats = {}, metadata = {}) {
    if (!isEnabled()) {
        logger.debug('[lm-studio-logger] Logging disabled (env vars not set)');
        return;
    }

    try {
        const conversationsDir = getConversationsDir();
        const chatDir = path.join(conversationsDir, String(chatId || 'global'));

        ensureDir(chatDir);

        const timestamp = Date.now();

        // Generate conversation name from metadata
        let conversationName = metadata.source || 'AI Conversation';
        if (metadata.model) {
            conversationName = `${metadata.source}: ${metadata.model}`;
        }

        const conversation = {
            name: conversationName,
            pinned: false,
            createdAt: timestamp,
            preset: '',
            tokenCount: stats.totalTokensCount || 0,
            userLastMessagedAt: timestamp,
            systemPrompt: "",
            messages: [
                {
                    versions: [
                        {
                            type: 'singleStep',
                            role: 'user',
                            content: [
                                {
                                    type: 'text',
                                    text: userMessage
                                }
                            ]
                        }
                    ],
                    currentlySelected: 0
                },
                {
                    versions: [
                        {
                            type: 'multiStep',
                            role: 'assistant',
                            steps: [
                                {
                                    type: 'contentBlock',
                                    stepIdentifier: `${timestamp}-0.${Math.random().toString().slice(2, 18)}`,
                                    content: [
                                        {
                                            type: 'text',
                                            text: responseText,
                                            fromDraftModel: false,
                                            tokensCount: stats.predictedTokensCount || 0,
                                            isStructural: false
                                        }
                                    ],
                                    defaultShouldIncludeInContext: true,
                                    shouldIncludeInContext: true,
                                    genInfo: {
                                        indexedModelIdentifier: metadata.model || 'unknown',
                                        identifier: metadata.model || 'unknown',
                                        loadModelConfig: { fields: [] },
                                        predictionConfig: {
                                            fields: [
                                                {
                                                    key: "llm.prediction.temperature",
                                                    value: 0.7  // Default assumed
                                                }
                                            ]
                                        },
                                        stats: {
                                            stopReason: stats.stopReason || 'eosFound',
                                            tokensPerSecond: stats.tokensPerSecond || 0,
                                            timeToFirstTokenSec: stats.timeToFirstTokenSec || 0,
                                            totalTimeSec: stats.totalTimeSec || 0,
                                            promptTokensCount: stats.promptTokensCount || 0,
                                            predictedTokensCount: stats.predictedTokensCount || 0,
                                            totalTokensCount: stats.totalTokensCount || 0
                                        }
                                    }
                                }
                            ],
                            senderInfo: {
                                senderName: metadata.model || 'unknown'
                            }
                        }
                    ],
                    currentlySelected: 0
                }
            ],
            usePerChatPredictionConfig: true,
            perChatPredictionConfig: {
                fields: [
                    {
                        key: "llm.prediction.systemPrompt",
                        value: systemPrompt || ""
                    }
                ]
            },
            clientInput: '',
            clientInputFiles: [],
            userFilesSizeBytes: 0,
            lastUsedModel: {
                identifier: metadata.model || 'unknown',
                indexedModelIdentifier: metadata.model || 'unknown',
                instanceLoadTimeConfig: { fields: [] },
                instanceOperationTimeConfig: { fields: [] }
            },
            notes: [],
            plugins: [],
            pluginConfigs: {},
            disabledPluginTools: [],
            looseFiles: [],
            assistantLastMessagedAt: timestamp + 100,
            // Custom metadata for our bot
            _botMetadata: metadata
        };

        const jsonPath = path.join(chatDir, `${timestamp}.conversation.json`);
        fs.writeFileSync(jsonPath, JSON.stringify(conversation, null, 2));
        logger.debug(`[lm-studio-logger] 💾 Saved text conversation: ${jsonPath}`);
    } catch (e) {
        logger.warn(`[lm-studio-logger] ⚠️ Failed to save conversation: ${e.message}`);
    }
}

/**
 * Salva una conversazione con immagine (Vision LLM).
 *
 * @param {string|number} chatId - ID chat Telegram
 * @param {string} systemPrompt - System prompt
 * @param {string} userMessage - Messaggio utente
 * @param {string} base64Image - Immagine in Base64
 * @param {string} responseText - Risposta del modello
 * @param {Object} stats - Statistiche risposta
 * @param {Object} metadata - Metadati aggiuntivi
 */
function saveVisionConversation(chatId, systemPrompt, userMessage, base64Image, responseText, stats = {}, metadata = {}) {
    if (!isEnabled()) {
        logger.debug('[lm-studio-logger] Logging disabled (env vars not set)');
        return;
    }

    try {
        const conversationsDir = getConversationsDir();
        const userFilesDir = getUserFilesDir();
        const chatDir = path.join(conversationsDir, String(chatId));

        ensureDir(chatDir);
        ensureDir(userFilesDir);

        const timestamp = Date.now();
        const imageBuffer = Buffer.from(base64Image, 'base64');
        const imageSize = imageBuffer.length;
        const sha256Hex = crypto.createHash('sha256').update(imageBuffer).digest('hex');

        // Generate random number for file identifier (like LM Studio does)
        const randomNum = Math.floor(Math.random() * 100);
        const fileIdentifier = `${timestamp} - ${randomNum}.jpg`;

        // Save image to user-files directory
        const imagePath = path.join(userFilesDir, fileIdentifier);
        fs.writeFileSync(imagePath, imageBuffer);

        // Create metadata file
        const metadataPath = path.join(userFilesDir, `${fileIdentifier}.metadata.json`);
        const imageMetadata = {
            type: 'image',
            sizeBytes: imageSize,
            originalName: `media_${chatId}_${timestamp}.jpg`,
            fileIdentifier: fileIdentifier,
            preview: {
                data: `data:image/jpeg;base64,${base64Image}`
            },
            sha256Hex: sha256Hex
        };
        fs.writeFileSync(metadataPath, JSON.stringify(imageMetadata, null, 2));

        logger.debug(`[lm-studio-logger] 🖼️ Saved image: ${imagePath}`);

        // Generate conversation name from primary category if available
        let conversationName = metadata.source || 'Vision Analysis';
        try {
            const parsed = JSON.parse(responseText.match(/\{[\s\S]*\}/)?.[0] || '{}');
            if (parsed.primary_category) {
                conversationName = `${metadata.source}: ${parsed.primary_category}`;
            }
        } catch (e) { }

        const conversation = {
            name: conversationName,
            pinned: false,
            createdAt: timestamp,
            preset: '',
            tokenCount: stats.totalTokensCount || 0,
            userLastMessagedAt: timestamp,
            systemPrompt: systemPrompt,
            messages: [
                {
                    versions: [
                        {
                            type: 'singleStep',
                            role: 'user',
                            content: [
                                {
                                    type: 'text',
                                    text: userMessage
                                },
                                {
                                    type: 'file',
                                    fileIdentifier: fileIdentifier,
                                    fileType: 'image',
                                    sizeBytes: imageSize
                                }
                            ]
                        }
                    ],
                    currentlySelected: 0
                },
                {
                    versions: [
                        {
                            type: 'multiStep',
                            role: 'assistant',
                            steps: [
                                {
                                    type: 'contentBlock',
                                    stepIdentifier: `${timestamp}-0.${Math.random().toString().slice(2, 18)}`,
                                    content: [
                                        {
                                            type: 'text',
                                            text: responseText,
                                            fromDraftModel: false,
                                            tokensCount: stats.predictedTokensCount || 0,
                                            isStructural: false
                                        }
                                    ],
                                    defaultShouldIncludeInContext: true,
                                    shouldIncludeInContext: true,
                                    genInfo: {
                                        indexedModelIdentifier: metadata.model || 'unknown',
                                        identifier: metadata.model || 'unknown',
                                        loadModelConfig: { fields: [] },
                                        predictionConfig: {
                                            fields: [
                                                {
                                                    key: "llm.prediction.temperature",
                                                    value: 0.7
                                                }
                                            ]
                                        },
                                        stats: {
                                            stopReason: stats.stopReason || 'eosFound',
                                            tokensPerSecond: stats.tokensPerSecond || 0,
                                            timeToFirstTokenSec: stats.timeToFirstTokenSec || 0,
                                            totalTimeSec: stats.totalTimeSec || 0,
                                            promptTokensCount: stats.promptTokensCount || 0,
                                            predictedTokensCount: stats.predictedTokensCount || 0,
                                            totalTokensCount: stats.totalTokensCount || 0
                                        }
                                    }
                                }
                            ],
                            senderInfo: {
                                senderName: metadata.model || 'unknown'
                            }
                        }
                    ],
                    currentlySelected: 0
                }
            ],
            usePerChatPredictionConfig: true,
            perChatPredictionConfig: { fields: [] },
            clientInput: '',
            clientInputFiles: [],
            userFilesSizeBytes: imageSize,
            lastUsedModel: {
                identifier: metadata.model || 'unknown',
                indexedModelIdentifier: metadata.model || 'unknown',
                instanceLoadTimeConfig: { fields: [] },
                instanceOperationTimeConfig: { fields: [] }
            },
            notes: [],
            plugins: [],
            pluginConfigs: {},
            disabledPluginTools: [],
            looseFiles: [],
            assistantLastMessagedAt: timestamp + 100,
            _botMetadata: metadata
        };

        const jsonPath = path.join(chatDir, `${timestamp}.conversation.json`);
        fs.writeFileSync(jsonPath, JSON.stringify(conversation, null, 2));
        logger.debug(`[lm-studio-logger] 💾 Saved vision conversation: ${jsonPath}`);
    } catch (e) {
        logger.warn(`[lm-studio-logger] ⚠️ Failed to save vision conversation: ${e.message}`);
    }
}

// Log status at startup
if (isEnabled()) {
    logger.info(`[lm-studio-logger] ✅ Enabled - Instance: ${getInstance()}`);
    logger.info(`[lm-studio-logger]    Conversations: ${getConversationsDir()}`);
    logger.info(`[lm-studio-logger]    User files: ${getUserFilesDir()}`);
} else {
    logger.debug('[lm-studio-logger] Disabled (LM_STUDIO_CONVERSATIONS_DIR or LM_STUDIO_USER_FILES_DIR not set)');
}

module.exports = {
    isEnabled,
    saveTextConversation,
    saveVisionConversation,
    getConversationsDir,
    getUserFilesDir
};
