/**
 * @fileoverview Modulo Mascotte AI
 * @module features/ai-mascot
 */
const logger = require('../../middlewares/logger');
const buffer = require('./buffer');
const { SYSTEM_PROMPT } = require('./personality');
const axios = require('axios');

// Configurazione
const ENABLED_INSTANCE = 'rwby';
const REPLY_CHANCE = parseFloat(process.env.AI_MASCOT_CHANCE || '0.2'); // 20% default
const AI_URL = process.env.LM_STUDIO_URL || 'http://localhost:1234';
const AI_MODEL = process.env.AI_MASCOT_MODEL || process.env.LM_STUDIO_SCAM_MODEL || 'qwen3-vl-4b';

let _bot;

/**
 * Inizializza il modulo se siamo sull'istanza giusta.
 */
function init(db) {
    // Check istanza gestito da feature-flags.js, ma doppio controllo male non fa
    // (in realtà qui init viene chiamato solo se feature-flags dice OK)
    logger.info(`[ai-mascot] Initialized. Chance: ${REPLY_CHANCE * 100}%, Model: ${AI_MODEL}`);
}

/**
 * Genera una risposta usando LM Studio.
 */
async function generateReply(guildId, userMessage, replyContext = null) {
    try {
        const history = buffer.getFormattedHistory(guildId);

        // Separiamo nettamente contesto (storia) e target (ultimo messaggio)
        let promptContent = `CONTESTO (Cronologia recente):\n${history}\n\n`;

        // Se è una risposta a un altro messaggio
        if (replyContext) {
            promptContent += `TARGET (Rispondi a questo):\n`;
            promptContent += `[${userMessage.username} risponde a ${replyContext.author}: "${replyContext.text}"]\n`;
            promptContent += `${userMessage.username}: ${userMessage.text}\n`;
        } else {
            // Messaggio normale
            promptContent += `TARGET (Rispondi a questo):\n`;
            promptContent += `${userMessage.username}: ${userMessage.text}\n`;
        }

        // Istruzione esplicita finale per evitare che risponda a tutto il contesto
        promptContent += `\n(Rispondi SOLO al messaggio nel TARGET)\n`;
        promptContent += `RWBY:`;

        // Costruiamo il payload per l'LLM
        const payload = {
            model: AI_MODEL,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: promptContent }
            ],
            temperature: 0.8, // Creativa
            max_tokens: 150,
            stop: ["\n\n", "User:", "Author:", "CHAT:", "\n["]
        };

        const response = await axios.post(`${AI_URL}/v1/chat/completions`, payload, { timeout: 10000 });

        if (response.data && response.data.choices && response.data.choices.length > 0) {
            return response.data.choices[0].message.content.trim();
        }
    } catch (e) {
        logger.error(`[ai-mascot] Error generating reply: ${e.message}`);
        return null;
    }
    return null;
}

/**
 * Registra i listener del bot.
 */
function register(bot) {
    _bot = bot;

    bot.on('message:text', async (ctx, next) => {
        // Ignora canali, bot e messaggi privati (per ora solo gruppi)
        if (ctx.chat.type === 'private' || ctx.from.is_bot) {
            return next();
        }

        const guildId = ctx.chat.id;
        const text = ctx.message.text;
        const username = ctx.from.first_name;

        // 1. Aggiungi al buffer
        buffer.addMessage(guildId, {
            userId: ctx.from.id,
            username: username,
            text: text
        });

        // 2. Tira il dado per rispondere (Roll)
        // Se ci hanno menzionato o risposto direttamente, probabilità 100% (opzionale, per ora lasciamo 20% random o reply esplicita)
        const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;
        const isMention = text.includes(`@${ctx.me.username}`);

        const shouldReply = isReplyToBot || isMention || (Math.random() < REPLY_CHANCE);

        if (shouldReply) {
            // Se è una risposta, prendiamo il testo originale
            let replyContext = null;
            if (ctx.message.reply_to_message) {
                const reply = ctx.message.reply_to_message;
                // Gestiamo il caso in cui il messaggio originale contenga testo
                const replyText = reply.text || reply.caption || '[Media/Sticker]';
                replyContext = {
                    author: reply.from.first_name,
                    text: replyText
                };
            }

            // Simula "sta scrivendo..."
            await ctx.replyWithChatAction('typing');

            // Genera risposta
            const response = await generateReply(guildId, { username, text }, replyContext);

            if (response) {
                // Aspetta un attimo per realismo (opzionale, ma carino)
                // await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));

                try {
                    await ctx.reply(response, {
                        reply_to_message_id: ctx.message.message_id
                    });
                    logger.info(`[ai-mascot] Replied to ${username} in ${guildId}`);
                } catch (e) {
                    logger.error(`[ai-mascot] Failed to send reply: ${e.message}`);
                }
            }
        }

        return next();
    });
}

module.exports = {
    init,
    register
};
