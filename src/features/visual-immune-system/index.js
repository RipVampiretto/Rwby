const fs = require('fs');
const path = require('path');
const https = require('https');
const imghash = require('imghash');
const { safeDelete, safeEdit, safeBan, isAdmin, handleCriticalError, isFromSettingsMenu } = require('../../utils/error-handlers');
const loggerUtil = require('../../middlewares/logger');

const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');

let db = null;
let _botInstance = null;
const TEMP_DIR = path.join(__dirname, '../../temp_visual');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Handler: photos and stickers
    bot.on(["message:photo", "message:sticker"], async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip admins
        if (await isAdmin(ctx, 'visual-immune-system')) return next();

        // Config check
        const config = db.getGuildConfig(ctx.chat.id);
        if (!config.visual_enabled) return next();

        // Tier bypass
        if (ctx.userTier !== undefined && ctx.userTier >= 3) return next();

        await processVisual(ctx, config);
        await next();
    });

    // Command: /visualconfig
    bot.command("visualconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        if (!await isAdmin(ctx, 'visual-immune-system')) return;

        await sendConfigUI(ctx);
    });

    // Command: /visualban
    bot.command("visualban", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        if (!await isAdmin(ctx, 'visual-immune-system')) return;

        if (!ctx.message.reply_to_message || !ctx.message.reply_to_message.photo) {
            return ctx.reply("❌ Rispondi a un'immagine.");
        }

        const category = ctx.message.text.split(' ')[1] || 'spam';
        await addToDb(ctx, ctx.message.reply_to_message, 'ban', category);
    });

    // Command: /visualsafe
    bot.command("visualsafe", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        if (!await isAdmin(ctx, 'visual-immune-system')) return;

        if (!ctx.message.reply_to_message || !ctx.message.reply_to_message.photo) {
            return ctx.reply("❌ Rispondi a un'immagine.");
        }

        await addToDb(ctx, ctx.message.reply_to_message, 'safe', 'safe');
    });

    // UI Callback
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("vis_")) return next();

        const config = db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === "vis_close") return ctx.deleteMessage();

        if (data === "vis_toggle") {
            db.updateGuildConfig(ctx.chat.id, { visual_enabled: config.visual_enabled ? 0 : 1 });
        } else if (data === "vis_sync") {
            db.updateGuildConfig(ctx.chat.id, { visual_sync_global: config.visual_sync_global ? 0 : 1 });
        } else if (data === "vis_thr") {
            let thr = config.visual_hamming_threshold || 5;
            thr = thr >= 15 ? 1 : thr + 1;
            db.updateGuildConfig(ctx.chat.id, { visual_hamming_threshold: thr });
        } else if (data === "vis_act") {
            const acts = ['delete', 'ban', 'report_only'];
            let cur = config.visual_action || 'delete';
            if (!acts.includes(cur)) cur = 'delete';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 3];
            db.updateGuildConfig(ctx.chat.id, { visual_action: nextAct });
        }

        await sendConfigUI(ctx, true, fromSettings);
    });
}

async function processVisual(ctx, config) {
    let fileId;
    if (ctx.message.photo) fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    else if (ctx.message.sticker) fileId = ctx.message.sticker.file_id;
    else return;

    const file = await ctx.api.getFile(fileId);
    const downloadUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    const localPath = path.join(TEMP_DIR, `${file.file_unique_id}.jpg`);

    await downloadFile(downloadUrl, localPath);

    try {
        const hash = await imghash.hash(localPath, 16);
        const match = findMatch(hash, ctx.chat.id, config.visual_hamming_threshold || 5);
        if (match && match.type === 'ban') {
            await executeAction(ctx, config.visual_action || 'delete', match, hash);
        }
    } catch (e) {
        handleCriticalError('visual-immune', 'processVisual', e, ctx);
    } finally {
        try { fs.unlinkSync(localPath); } catch (e) { /* cleanup - ignore */ }
    }
}

async function addToDb(ctx, msg, type, category) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const file = await ctx.api.getFile(fileId);
    const downloadUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    const localPath = path.join(TEMP_DIR, `${file.file_unique_id}_add.jpg`);

    await downloadFile(downloadUrl, localPath);
    try {
        const hash = await imghash.hash(localPath);
        db.getDb().prepare(`INSERT INTO visual_hashes (phash, type, category, guild_id, match_count, created_at) VALUES (?, ?, ?, ?, 0, ?)`)
            .run(hash, type, category, ctx.chat.id, new Date().toISOString());
        await ctx.reply(`✅ Immagine salvata come **${type}** (${category}). Hash: \`${hash}\``, { parse_mode: 'Markdown' });
    } catch (e) {
        await ctx.reply("❌ Errore: " + e.message);
    } finally {
        try { fs.unlinkSync(localPath); } catch (e) { /* cleanup - ignore */ }
    }
}

function findMatch(targetHash, guildId, threshold) {
    const stmt = db.getDb().prepare(`SELECT * FROM visual_hashes WHERE guild_id = ? OR guild_id = 0`);
    const hashes = stmt.all(guildId);

    let bestMatch = null;
    let minDist = Infinity;

    for (const entry of hashes) {
        const dist = hammingDistance(targetHash, entry.phash);
        if (dist <= threshold && dist < minDist) {
            minDist = dist;
            bestMatch = entry;
        }
    }

    return bestMatch;
}

function hammingDistance(h1, h2) {
    let count = 0;
    // imghash returns hex string.
    let dist = 0;
    for (let i = 0; i < h1.length; i++) {
        let v1 = parseInt(h1[i], 16);
        let v2 = parseInt(h2[i], 16);
        let val = v1 ^ v2;
        while (val) {
            dist++;
            val &= val - 1;
        }
    }
    return dist;
}

async function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
}

async function executeAction(ctx, action, match, currentHash) {
    const user = ctx.from;
    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'visual_ban',
        targetUser: user,
        executorAdmin: null,
        reason: `Visual Match (${match.category})`,
        isGlobal: (action === 'ban')
    };

    try {
        db.getDb().prepare("UPDATE visual_hashes SET match_count = match_count + 1 WHERE id = ?").run(match.id);
    } catch (e) { }

    if (action === 'delete') {
        await safeDelete(ctx, 'visual-immune');
    }
    else if (action === 'ban') {
        await safeDelete(ctx, 'visual-immune');
        const banned = await safeBan(ctx, user.id, 'visual-immune');

        if (banned) {
            userReputation.modifyFlux(user.id, ctx.chat.id, -100, 'visual_ban');

            if (superAdmin.forwardBanToParliament) {
                superAdmin.forwardBanToParliament({
                    user: user,
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: `Visual Ban: ${match.category} (Dist: ${hammingDistance(currentHash, match.phash)})`,
                    evidence: `Hash: ${currentHash}`,
                    flux: userReputation.getLocalFlux(user.id, ctx.chat.id)
                });
            }

            logParams.eventType = 'ban';
            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
        }
    }
    else if (action === 'report_only') {
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Visual-Immune',
            user: user,
            reason: `Match: ${match.category}`,
            messageId: ctx.message.message_id,
            content: `[Image Match ID ${match.id}]`
        });
    }
}

async function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.visual_enabled ? '✅ ON' : '❌ OFF';
    const sync = config.visual_sync_global ? '✅ ON' : '❌ OFF';
    const action = (config.visual_action || 'delete').toUpperCase();
    const thr = config.visual_hamming_threshold || 5;

    const text = `🧬 **IMMUNITÀ VISIVA**\n\n` +
        `Riconosce e blocca le immagini che sono già state segnalate in passato.\n` +
        `Anche se vengono leggermente modificate, il bot le riconosce lo stesso.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Blocca meme spam o immagini raid ricorrenti\n` +
        `• Condivide le "impronte" delle immagini cattive con altri gruppi\n` +
        `• Molto veloce ed efficace\n\n` +
        `Stato: ${enabled}\n` +
        `Globale: ${sync}\n` +
        `Azione: ${action}\n` +
        `Precisione: ${thr}`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "vis_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `🧬 Sys: ${enabled}`, callback_data: "vis_toggle" }, { text: `🌐 Sync: ${sync}`, callback_data: "vis_sync" }],
            [{ text: `👮 Azione: ${action}`, callback_data: "vis_act" }],
            [{ text: `🎯 Soglia: ${thr}`, callback_data: "vis_thr" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'visual-immune');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = { register, sendConfigUI };
