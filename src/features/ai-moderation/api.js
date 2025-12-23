const logger = require('../../middlewares/logger');
const config = require('../../config/env');

const CACHE = new Map(); // Simple cache for message hashes
const CACHE_TTL = 3600000; // 1 hour
const CACHE_CLEANUP_INTERVAL = 600000; // 10 minutes

// Cleanup old cache entries every 10 minutes
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, value] of CACHE.entries()) {
        if (now - value.ts > CACHE_TTL) {
            CACHE.delete(key);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        logger.debug(`[ai-moderation] Cache cleanup: removed ${cleaned} expired entries, ${CACHE.size} remaining`);
    }
}, CACHE_CLEANUP_INTERVAL);

function djb2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) + hash + str.charCodeAt(i); /* hash * 33 + c */
    }
    return hash;
}

async function processWithAI(text, contextMessages, guildConfig, model = null) {
    // Create cache key including context and model
    const contextStr = contextMessages.map(m => m.text).join('|');
    const hash = djb2(text + contextStr + (model || ''));
    const cached = CACHE.get(hash);

    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return cached.res;
    }

    const result = await callLLM(text, contextMessages, guildConfig, model);
    CACHE.set(hash, { ts: Date.now(), res: result });

    return result;
}

async function callLLM(text, contextMessages, guildConfig, model = null) {
    const url = config.LM_STUDIO.url;
    const modelToUse = model || config.LM_STUDIO.model;

    // Build context string
    let contextStr = '';
    if (contextMessages.length > 0) {
        contextStr =
            '\n\nPrevious messages for context:\n' + contextMessages.map(m => `[${m.username}]: ${m.text}`).join('\n');
    }

    const systemPrompt = `You are a content moderation AI for Telegram groups. Your task is to classify messages for potential violations.

CATEGORIES (choose exactly ONE):
- "safe": Normal conversation, acceptable content, no violations
- "scam": Scams, phishing, fake giveaways, crypto schemes, money-making promises, suspicious links
- "nsfw": Sexual content, explicit material, pornographic references
- "hate": Hate speech, discrimination, racism, threats, harassment, bullying

IMPORTANT:
- Be conservative: if unsure, classify as "safe"
- Consider context when available
- Focus on clear violations, not borderline cases

Respond with ONLY valid JSON (no markdown):
{"category": "safe|scam|nsfw|hate", "confidence": 0.0-1.0, "reason": "brief explanation"}`;

    const userMessage = text + contextStr;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.AI_TIMEOUTS.text);

        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelToUse,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.1,
                max_tokens: 150
            }),
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) throw new Error('API Error');
        const data = await response.json();
        const content = data.choices[0].message.content;

        // Extract JSON from markdown code block if present
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
        return JSON.parse(content);
    } catch (e) {
        // Fallback to safe
        logger.debug(`[ai-moderation] LLM call failed: ${e.message}`);
        return { category: 'safe', confidence: 1 };
    }
}

async function testConnection(ctx) {
    try {
        const url = config.LM_STUDIO.url;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.AI_TIMEOUTS.healthCheck);
        await fetch(`${url}/v1/models`, { signal: controller.signal });
        clearTimeout(timeout);
        await ctx.reply('✅ Connessione LM Studio con successo!');
    } catch (e) {
        await ctx.reply(`❌ Errore connessione LM Studio: ${e.message}`);
    }
}

module.exports = {
    processWithAI,
    callLLM,
    testConnection
};
