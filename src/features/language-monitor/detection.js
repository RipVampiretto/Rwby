const logger = require('../../middlewares/logger');

let eld = null;
let eldReady = false;

// Load ELD dynamically (ESM) - block until ready
const eldPromise = import('eld')
    .then(m => {
        eld = m.eld;
        eldReady = true;
        logger.info('[language-monitor] ELD library loaded successfully');
    })
    .catch(e => {
        logger.error(`[language-monitor] Failed to load ELD: ${e.message}`);
    });

/**
 * Check if text contains non-Latin scripts (Chinese, Arabic, Cyrillic, etc.)
 * This catches foreign text even in very short messages
 */
function detectNonLatinScript(text) {
    // Chinese/Japanese/Korean
    if (/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text)) return 'zh';
    // Arabic
    if (/[\u0600-\u06ff]/.test(text)) return 'ar';
    // Cyrillic (Russian, etc.)
    if (/[\u0400-\u04ff]/.test(text)) return 'ru';
    // Hebrew
    if (/[\u0590-\u05ff]/.test(text)) return 'he';
    // Thai
    if (/[\u0e00-\u0e7f]/.test(text)) return 'th';
    // Hindi/Devanagari
    if (/[\u0900-\u097f]/.test(text)) return 'hi';

    return null; // Latin or unknown
}

async function detectLanguage(text) {
    if (!eldReady) {
        await eldPromise;
    }

    // Fallback if still not ready
    if (!eld) return null;

    const result = eld.detect(text);

    // ELD returns { language: 'es', getScores(), isReliable() }
    // Empty string means undetermined
    if (!result.language) return null;

    return result.language; // Already ISO 639-1!
}

module.exports = {
    detectNonLatinScript,
    detectLanguage,
    isReady: () => eldReady,
    waitForReady: () => eldPromise
};
