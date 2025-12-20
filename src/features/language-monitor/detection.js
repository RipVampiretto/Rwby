const loggerUtil = require('../../middlewares/logger');

let franc = null;
let francReady = false;

// Load franc dynamically (ESM) - block until ready
const francPromise = import('franc').then(m => {
    franc = m.franc;
    francReady = true;
    loggerUtil.info('[language-monitor] Franc library loaded successfully');
}).catch(e => {
    loggerUtil.error(`[language-monitor] Failed to load franc: ${e.message}`);
});

function getIso1(iso3) {
    // Simple mapping for common checks. franc returns ISO-639-3
    const map = {
        'ita': 'it', 'eng': 'en', 'rus': 'ru', 'spa': 'es', 'fra': 'fr', 'deu': 'de',
        'por': 'pt', 'zho': 'zh', 'jpn': 'ja', 'ara': 'ar', 'hin': 'hi'
    };
    return map[iso3] || iso3;
}

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
    if (!francReady) {
        await francPromise;
    }

    // Fallback if still not ready
    if (!franc) return null;

    const detectedIso3 = franc(text);
    if (detectedIso3 === 'und') return null;
    return getIso1(detectedIso3);
}

module.exports = {
    detectNonLatinScript,
    detectLanguage,
    isReady: () => francReady,
    waitForReady: () => francPromise
};
