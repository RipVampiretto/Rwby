const logger = require('../../middlewares/logger');

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
        hash = ((hash << 5) + hash) + str.charCodeAt(i); /* hash * 33 + c */
    }
    return hash;
}

async function processWithAI(text, contextMessages, config) {
    // Create cache key including context
    const contextStr = contextMessages.map(m => m.text).join('|');
    const hash = djb2(text + contextStr);
    const cached = CACHE.get(hash);

    if (cached && (Date.now() - cached.ts < CACHE_TTL)) {
        return cached.res;
    }

    const result = await callLLM(text, contextMessages, config);
    CACHE.set(hash, { ts: Date.now(), res: result });

    return result;
}

async function callLLM(text, contextMessages, config) {
    const url = process.env.LM_STUDIO_URL || 'http://localhost:1234';

    // Build context string
    let contextStr = '';
    if (contextMessages.length > 0) {
        contextStr = '\n\nPrevious messages for context:\n' +
            contextMessages.map(m => `[${m.username}]: ${m.text}`).join('\n');
    }

    const systemPrompt = `You are a chat moderation AI. Classify the user's message for a Telegram group moderation bot.

Categories (choose ONE):
- "safe": Normal, acceptable content
- "scam": Scams, phishing, fake giveaways, crypto schemes, money-making promises
- "nsfw": Sexual content, explicit material
- "spam": Unsolicited promotion, advertising, repetitive content

Respond with ONLY a JSON object:
{"category": "...", "confidence": 0.0-1.0, "reason": "brief explanation"}`;

    const userMessage = text + contextStr;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: process.env.LM_STUDIO_MODEL || undefined, // Use specific model if set
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage }
                ],
                temperature: 0.1,
                max_tokens: 150
            }),
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) throw new Error("API Error");
        const data = await response.json();
        const content = data.choices[0].message.content;

        // Extract JSON from markdown code block if present
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
        return JSON.parse(content);

    } catch (e) {
        // Fallback to safe
        logger.debug(`[ai-moderation] LLM call failed: ${e.message}`);
        return { category: "safe", confidence: 1 };
    }
}

async function testConnection(ctx) {
    try {
        const url = process.env.LM_STUDIO_URL || 'http://localhost:1234';
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        await fetch(`${url}/v1/models`, { signal: controller.signal });
        clearTimeout(timeout);
        await ctx.reply("✅ Connessione LM Studio con successo!");
    } catch (e) {
        await ctx.reply(`❌ Errore connessione LM Studio: ${e.message}`);
    }
}

module.exports = {
    processWithAI,
    callLLM,
    testConnection
};
