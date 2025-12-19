const fs = require('fs');
const path = require('path');
const https = require('https');
const { Readable } = require('stream');
const fluentFfmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const sharp = require('sharp');
fluentFfmpeg.setFfmpegPath(ffmpegPath);

const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');

let db = null;
let _botInstance = null;
const TEMP_DIR = path.join(__dirname, '../../temp_nsfw');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Handler: photos, videos, animations
    bot.on(["message:photo", "message:video", "message:animation", "message:document"], async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip admins
        const member = await ctx.getChatMember(ctx.from.id);
        if (['creator', 'administrator'].includes(member.status)) return next();

        // Config check
        const config = db.getGuildConfig(ctx.chat.id);
        if (!config.nsfw_enabled) return next();

        // Tier bypass
        if (ctx.userTier !== undefined && ctx.userTier >= (config.nsfw_tier_bypass || 3)) return next();

        // Check types enabled
        const isVideo = ctx.message.video || (ctx.message.document && ctx.message.document.mime_type.startsWith('video'));
        const isGif = ctx.message.animation || (ctx.message.document && ctx.message.document.mime_type === 'image/gif');
        const isPhoto = ctx.message.photo;

        if (isVideo && !config.nsfw_check_videos) return next();
        if (isGif && !config.nsfw_check_gifs) return next();
        if (isPhoto && !config.nsfw_check_photos) return next();

        // Download and analyze
        // Fire and forget to avoid blocking, but handle errors
        processMedia(ctx, config).catch(err => console.error("NSFW Process Error", err));

        await next();
    });

    // Command: /nsfwconfig
    bot.command("nsfwconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        const member = await ctx.getChatMember(ctx.from.id);
        if (!['creator', 'administrator'].includes(member.status)) return;

        await sendConfigUI(ctx);
    });

    // UI Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("nsf_")) return next();

        const config = db.getGuildConfig(ctx.chat.id);
        // Check if we came from settings menu
        let fromSettings = false;
        try {
            const markup = ctx.callbackQuery.message.reply_markup;
            if (markup && markup.inline_keyboard) {
                fromSettings = markup.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'settings_main'));
            }
        } catch (e) { }

        if (data === "nsf_close") return ctx.deleteMessage();

        if (data === "nsf_toggle") {
            db.updateGuildConfig(ctx.chat.id, { nsfw_enabled: config.nsfw_enabled ? 0 : 1 });
        } else if (data === "nsf_test") {
            await testConnection(ctx);
            return;
        } else if (data === "nsf_act") {
            const acts = ['delete', 'ban', 'report_only'];
            let cur = config.nsfw_action || 'delete';
            if (!acts.includes(cur)) cur = 'delete';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 3];
            db.updateGuildConfig(ctx.chat.id, { nsfw_action: nextAct });
        } else if (data === "nsf_thr") {
            let thr = config.nsfw_threshold || 0.7;
            thr = thr >= 0.9 ? 0.5 : thr + 0.1;
            db.updateGuildConfig(ctx.chat.id, { nsfw_threshold: parseFloat(thr.toFixed(1)) });
        } else if (data.startsWith("nsf_tog_")) {
            const type = data.split('_')[2]; // photo, video, gif
            const key = `nsfw_check_${type}s`;
            if (config[key] !== undefined) {
                db.updateGuildConfig(ctx.chat.id, { [key]: config[key] ? 0 : 1 });
            }
        }

        await sendConfigUI(ctx, true, fromSettings);
    });
}

async function processMedia(ctx, config) {
    let fileId;
    let type = 'photo';

    if (ctx.message.photo) {
        fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    } else if (ctx.message.video) {
        fileId = ctx.message.video.file_id;
        type = 'video';
    } else if (ctx.message.animation) {
        fileId = ctx.message.animation.file_id;
        type = 'gif';
    } else if (ctx.message.document) {
        fileId = ctx.message.document.file_id;
        if (ctx.message.document.mime_type.startsWith('video')) type = 'video';
        else if (ctx.message.document.mime_type.startsWith('image')) type = 'photo';
        else return;
    }

    const file = await ctx.api.getFile(fileId);
    const downloadUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    const ext = path.extname(file.file_path) || (type === 'video' ? '.mp4' : '.jpg');
    const localPath = path.join(TEMP_DIR, `${file.file_unique_id}${ext}`);

    await downloadFile(downloadUrl, localPath);

    try {
        let isNsfw = false;
        let reasons = [];

        if (type === 'video' || type === 'gif') {
            isNsfw = await checkVideo(localPath, config, reasons);
        } else {
            isNsfw = await checkImage(localPath, config, reasons);
        }

        if (isNsfw) {
            await executeAction(ctx, config.nsfw_action || 'delete', reasons[0], type);
        }
    } finally {
        // Cleanup main file
        try { fs.unlinkSync(localPath); } catch (e) { }
    }
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

async function checkImage(imagePath, config, reasons) {
    // Resize/Compress before sending to LLM for speed? Vision models often handle standard resolutions.
    // Convert to base64
    const buffer = fs.readFileSync(imagePath);
    const base64 = buffer.toString('base64');

    const res = await callVisionLLM(base64, config);
    if (res.nsfw && res.confidence >= (config.nsfw_threshold || 0.7)) {
        reasons.push(`${res.category} (${Math.round(res.confidence * 100)}%)`);
        return true;
    }
    return false;
}

async function checkVideo(videoPath, config, reasons) {
    // Get duration
    const duration = await getVideoDuration(videoPath);
    if (!duration) return false;

    // Extract frames: every 5%
    const intervalPct = config.nsfw_frame_interval_percent || 5;
    const timestamps = [];
    for (let pct = intervalPct; pct < 100; pct += intervalPct) {
        timestamps.push((pct / 100) * duration);
    }

    // Safety cap: max 20 frames
    if (timestamps.length > 20) timestamps.length = 20;

    for (const ts of timestamps) {
        const framePath = path.join(TEMP_DIR, `frame_${path.basename(videoPath)}_${ts}.jpg`);
        try {
            await extractFrame(videoPath, ts, framePath);
            const isNsfw = await checkImage(framePath, config, reasons);
            fs.unlinkSync(framePath); // cleanup frame

            if (isNsfw) {
                reasons[0] += ` @ ${ts.toFixed(1)}s`;
                return true; // Stop early
            }
        } catch (e) {
            console.error("Frame check error", e);
        }
    }
    return false;
}

function getVideoDuration(filePath) {
    return new Promise((resolve) => {
        fluentFfmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) resolve(0);
            else resolve(metadata.format.duration);
        });
    });
}

function extractFrame(videoPath, timestamp, outputPath) {
    return new Promise((resolve, reject) => {
        fluentFfmpeg(videoPath)
            .seekInput(timestamp)
            .frames(1)
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
    });
}

async function callVisionLLM(base64Image, config) {
    const url = process.env.LM_STUDIO_URL || 'http://localhost:1234';
    const systemPrompt = `You are an image content classifier. Analyze this image and respond ONLY with a JSON object:
{"nsfw": true/false, "category": "...", "confidence": 0.0-1.0, "reason": "..."}

Categories:
- "safe": Normal content
- "suggestive": Revealing clothing, provocative (borderline)
- "nsfw_partial": Partial nudity, underwear visible
- "nsfw_explicit": Full nudity, sexual content
- "gore": Violence, blood
`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout for vision

        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [
                    { role: "system", content: systemPrompt },
                    {
                        role: "user", content: [
                            { type: "text", text: "Classify this image." },
                            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                        ]
                    }
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

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
        return JSON.parse(content);

    } catch (e) {
        return { nsfw: false, category: "safe", confidence: 1 };
    }
}

async function executeAction(ctx, action, reason, type) {
    const user = ctx.from;
    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'nsfw_detect',
        targetUser: user,
        executorAdmin: null,
        reason: `NSFW (${type}): ${reason}`,
        isGlobal: (action === 'ban')
    };

    if (action === 'delete') {
        try { await ctx.deleteMessage(); } catch (e) { }
        // Log basic
        if (superAdmin.sendGlobalLog) {
            superAdmin.sendGlobalLog('image_spam', `🖼️ **Image Scan**\nGruppo: ${ctx.chat.title}\nUser: @${user.username}\nResult: NSFW Detected (${reason})`);
        }
    }
    else if (action === 'ban') {
        try {
            await ctx.deleteMessage();
            await ctx.banChatMember(user.id);
            userReputation.modifyFlux(user.id, ctx.chat.id, -100, 'nsfw_ban');

            if (superAdmin.forwardBanToParliament) {
                superAdmin.forwardBanToParliament({
                    user: user,
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: `NSFW Ban: ${reason}`,
                    evidence: `Check ${type}`,
                    flux: userReputation.getLocalFlux(user.id, ctx.chat.id)
                });
            }
            logParams.eventType = 'ban';
            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);

        } catch (e) { console.error(e); }
    }
    else if (action === 'report_only') {
        // Maybe forward image?
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'NSFW-Mon',
            user: user,
            reason: `${reason}`,
            messageId: ctx.message.message_id,
            content: `[Media ${type}]`
        });
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

async function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.nsfw_enabled ? '✅ ON' : '❌ OFF';
    const action = (config.nsfw_action || 'delete').toUpperCase();
    const thr = (config.nsfw_threshold || 0.7) * 100;

    // Toggles
    const p = config.nsfw_check_photos ? '✅' : '❌';
    const v = config.nsfw_check_videos ? '✅' : '❌';
    const g = config.nsfw_check_gifs ? '✅' : '❌';

    const text = `🔞 **NSFW CONFIG**\n` +
        `Stato: ${enabled}\n` +
        `Azione: ${action}\n` +
        `Soglia: ${thr}%\n` +
        `Checks: Foto ${p} | Vid ${v} | Gif ${g}`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "nsf_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `🔞 Monitor: ${enabled}`, callback_data: "nsf_toggle" }, { text: "🔗 Test Conn", callback_data: "nsf_test" }],
            [{ text: `👮 Azione: ${action}`, callback_data: "nsf_act" }, { text: `📊 Soglia: ${thr}%`, callback_data: "nsf_thr" }],
            [{ text: `📷 ${p}`, callback_data: "nsf_tog_photo" }, { text: `📹 ${v}`, callback_data: "nsf_tog_video" }, { text: `🎞️ ${g}`, callback_data: "nsf_tog_gif" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        try { await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' }); } catch (e) { }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = { register, sendConfigUI };
