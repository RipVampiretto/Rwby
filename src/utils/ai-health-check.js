/**
 * @fileoverview Utils for AI Health Check
 * @module utils/ai-health-check
 */
const axios = require('axios');
const logger = require('../middlewares/logger');

/**
 * Verifies that all configured LLM models are available in the running LM Studio instance.
 * @returns {Promise<boolean>} True if all models are available, false otherwise.
 */
async function verifyModels() {
    const aiUrl = process.env.LM_STUDIO_URL || 'http://localhost:1234';

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

    logger.info(`[AI Check] Verifying ${requiredModels.length} models against ${aiUrl}...`);

    try {
        // 2. Fetch available models from LM Studio
        const response = await axios.get(`${aiUrl}/v1/models`, { timeout: 5000 });

        if (!response.data || !Array.isArray(response.data.data)) {
            logger.error('[AI Check] Invalid response from LM Studio /v1/models');
            return false;
        }

        const availableModelIds = response.data.data.map(m => m.id);
        const missingModels = [];

        // 3. Check for existence
        for (const req of requiredModels) {
            // Loose check: verify if the available model ID contains the configured ID or vice-versa
            // often LM Studio model IDs are full paths or filenames.
            const isAvailable = availableModelIds.some(availId =>
                availId === req.id || availId.includes(req.id) || req.id.includes(availId)
            );

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
        logger.error(`[AI Check] Failed to connect to LM Studio at ${aiUrl}: ${e.message}`);
        logger.error('[AI Check] Ensure LM Studio is running and the API server is started.');
        return false;
    }
}

module.exports = { verifyModels };
