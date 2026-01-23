/**
 * @fileoverview Modulo Mascotte AI
 * @module features/ai-mascot
 */
const logger = require('../../middlewares/logger');
const buffer = require('./buffer');
const { searchWeb } = require('../../utils/search-client');
const { SYSTEM_PROMPT } = require('./personality');
const axios = require('axios');
const lmLogger = require('../../utils/lm-studio-logger');

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
    logger.info(`[ai-mascot] Initialized. Chance: ${REPLY_CHANCE * 100}%, Model: ${AI_MODEL}`);
}

/**
 * Genera una risposta usando LM Studio.
 * @param {string} guildId - ID del gruppo
 * @param {Object} userMessage - Messaggio utente {username, text}
 * @param {Object|null} replyContext - Contesto del messaggio a cui si risponde
 * @param {boolean} assistantMode - Se true, risponde come assistente (senza personalità RWBY)
 */
async function generateReply(guildId, userMessage, replyContext = null, assistantMode = false) {
    try {
        const history = buffer.getFormattedHistory(guildId);

        let messages;
        assistantMode = false

        if (assistantMode) {
            // Modalità assistente: Cerca su internet e risponde
            let cleanQuery = userMessage.text
                .replace(/@\w+/g, '') // Rimuove menzioni
                .replace(/cerca\s+su\s+internet\s*/i, '') // Rimuove "cerca su internet"
                .trim();

            let systemContent = "Sei un assistente AI utile e informativo. Rispondi in italiano. NON usare formattazione markdown complessa (grassetto, corsivo) se non necessario. Usa testo semplice quando possibile.";
            let userContent = cleanQuery;

            try {
                logger.info(`[ai-mascot] Searching web for: ${cleanQuery}`);
                const searchResults = await searchWeb(cleanQuery);

                if (searchResults && searchResults.length > 0) {
                    const formattedResults = searchResults.map(r => {
                        let text = `TITOLO: ${r.title}\nLINK: ${r.link}\nSNIPPET: ${r.snippet}`;
                        if (r.full_content) {
                            text += `\nCONTENUTO COMPLETO: ${r.full_content}`;
                        }
                        return text;
                    }).join('\n\n');

                    userContent = `DOMANDA UTENTE: ${cleanQuery}\n\nCONTESTO DAL WEB (Deep Search):\n${formattedResults}\n\nRispondi alla domanda utente usando le informazioni sopra. NON includere link o URL nella risposta.`;
                } else {
                    userContent = `DOMANDA UTENTE: ${cleanQuery}\n\n(Nessun risultato trovato sul web, rispondi basandoti sulle tue conoscenze)`;
                }
            } catch (e) {
                logger.error(`[ai-mascot] Search failed inside generateReply: ${e.message}`);
            }

            messages = [
                { role: "system", content: systemContent },
                { role: "user", content: userContent }
            ];
        } else {
            // Modalità mascotte: con personalità RWBY
            let promptContent = `CONTESTO (Cronologia recente):\n${history}\n\n`;

            if (replyContext) {
                promptContent += `TARGET (Rispondi a questo):\n`;
                promptContent += `[${userMessage.username} risponde a ${replyContext.author}: "${replyContext.text}"]\n`;
                promptContent += `${userMessage.username}: ${userMessage.text}\n`;
            } else {
                promptContent += `TARGET (Rispondi a questo):\n`;
                promptContent += `${userMessage.username}: ${userMessage.text}\n`;
            }

            promptContent += `\n(Rispondi SOLO al messaggio nel TARGET)\n`;
            promptContent += `RWBY:`;

            messages = [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: promptContent }
            ];
        }

        const payload = {
            model: AI_MODEL,
            messages,
            temperature: assistantMode ? 0.7 : 0.8,
            max_tokens: assistantMode ? 500 : 150,
            stop: assistantMode ? [] : ["\n\n", "User:", "Author:", "CHAT:", "\n["]
        };

        const response = await axios.post(`${AI_URL}/v1/chat/completions`, payload, { timeout: 30000 });

        if (response.data && response.data.choices && response.data.choices.length > 0) {
            const responseText = response.data.choices[0].message.content.trim();

            // Save conversation to LM Studio
            lmLogger.saveTextConversation(guildId, messages[0].content, messages[1].content, responseText, {
                totalTimeSec: 0
            }, {
                source: 'ai-mascot',
                model: AI_MODEL,
                username: userMessage.username,
                assistantMode
            });

            return responseText;
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
        // Ignora canali, bot e messaggi privati
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

        // 2. Check se il bot è stato menzionato o è una reply al bot
        const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;
        const isMention = text.toLowerCase().includes(`@${ctx.me.username.toLowerCase()}`);
        const isMentioned = isReplyToBot || isMention;

        // 3. Se è menzionato, risponde SEMPRE al 100%. Altrimenti roll casuale.
        const shouldReply = isMentioned || (Math.random() < REPLY_CHANCE);

        if (shouldReply) {
            // 4. Check per modalità "cerca su internet" (usa conoscenza interna, no personalità)
            const searchPattern = /cerca\s+su\s+internet/i;
            const assistantMode = isMentioned && searchPattern.test(text);

            // Se è una risposta, prendiamo il testo originale
            let replyContext = null;
            if (ctx.message.reply_to_message && !assistantMode) {
                const reply = ctx.message.reply_to_message;
                const replyText = reply.text || reply.caption || '[Media/Sticker]';
                replyContext = {
                    author: reply.from.first_name,
                    text: replyText
                };
            }

            // Simula "sta scrivendo..."
            await ctx.replyWithChatAction('typing');

            // Genera risposta
            const response = await generateReply(guildId, { username, text }, replyContext, assistantMode);

            if (response) {
                try {
                    await ctx.reply(response, {
                        reply_to_message_id: ctx.message.message_id,
                        parse_mode: 'Markdown'
                    });
                    logger.info(`[ai-mascot] Replied to ${username} in ${guildId}${assistantMode ? ' (assistant mode)' : ''}`);
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
