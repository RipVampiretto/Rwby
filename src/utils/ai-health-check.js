/**
 * @fileoverview Utils for AI Health Check
 * @module utils/ai-health-check
 */
const logger = require('../middlewares/logger');
const lmClient = require('./lm-studio-client');

/**
 * Verifies that all configured LLM models are available in the running LM Studio instance.
 * @returns {Promise<boolean>} True if all models are available, false otherwise.
 */
/**
 * Verifies that all configured LLM models are available in the running LM Studio instance.
 * @returns {Promise<boolean>} True if all models are available, false otherwise.
 */
async function verifyModels() {
    // 1. Identify required models from configuration
    const requiredModels = [];

    if (process.env.LM_STUDIO_MODEL) {
        requiredModels.push({ key: 'LM_STUDIO_MODEL', id: process.env.LM_STUDIO_MODEL });
    }

    if (process.env.LM_STUDIO_NSFW_MODEL) {
        requiredModels.push({ key: 'LM_STUDIO_NSFW_MODEL', id: process.env.LM_STUDIO_NSFW_MODEL });
    }

    if (process.env.LM_STUDIO_SCAM_MODEL) {
        requiredModels.push({ key: 'LM_STUDIO_SCAM_MODEL', id: process.env.LM_STUDIO_SCAM_MODEL });
    }

    if (process.env.AI_MASCOT_MODEL) {
        requiredModels.push({ key: 'AI_MASCOT_MODEL', id: process.env.AI_MASCOT_MODEL });
    }

    if (requiredModels.length === 0) {
        logger.warn('[AI Check] No AI models configured in .env. Skipping check.');
        return true;
    }

    logger.info(`[AI Check] Verifying ${requiredModels.length} models via SDK...`);

    try {
        // 2. Fetch available models from LM Studio SDK
        const loadedModels = await lmClient.listLoadedModels();

        if (!Array.isArray(loadedModels)) {
            logger.error('[AI Check] Invalid response from LM Studio SDK');
            return false;
        }

        // Map SDK model objects to IDs (identifier or path)
        const availableModelIds = loadedModels.map(m => m.identifier || m.path || m.id);
        const missingModels = [];

        // 3. Check for existence
        for (const req of requiredModels) {
            // Loose check: verify if the available model ID contains the configured ID or vice-versa
            // Also normalize paths (replace \ with /)
            const isAvailable = availableModelIds.some(availId => {
                const normAvail = availId.replace(/\\/g, '/');
                const normReq = req.id.replace(/\\/g, '/');
                return normAvail === normReq || normAvail.includes(normReq) || normReq.includes(normAvail);
            });

            if (!isAvailable) {
                missingModels.push(`${req.key}="${req.id}"`);
            }
        }

        if (missingModels.length > 0) {
            logger.error(`[AI Check] ❌ MISSING MODELS: The following configured models are not loaded in LM Studio:\n   - ${missingModels.join('\n   - ')}`);
            logger.info(`[AI Check] Available models in LM Studio:\n   - ${availableModelIds.join('\n   - ')}`);
            return false;
        }

        logger.info('[AI Check] ✅ All AI models are loaded and available.');
        return true;

    } catch (e) {
        logger.error(`[AI Check] Failed to connect to LM Studio: ${e.message}`);
        logger.error('[AI Check] Ensure LM Studio is running and the API server is started.');
        return false;
    }
}

module.exports = { verifyModels };
