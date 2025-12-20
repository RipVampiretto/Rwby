const fs = require('fs');
const path = require('path');
const https = require('https');
const { Readable } = require('stream');
const fluentFfmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const sharp = require('sharp');
fluentFfmpeg.setFfmpegPath(ffmpegPath);
fluentFfmpeg.setFfprobePath(ffprobePath);

const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');
const { safeDelete, safeEdit, safeBan, isAdmin, handleCriticalError, isFromSettingsMenu } = require('../../utils/error-handlers');
const loggerUtil = require('../../middlewares/logger');

let db = null;
let _botInstance = null;
const TEMP_DIR = path.join(__dirname, '../../temp_nsfw');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function register(bot, database) {
    db = database;
    _botInstance = bot;
    loggerUtil.info('[nsfw-monitor] Module registered and ready');

    // Handler: photos, videos, animations, stickers
    bot.on(["message:photo", "message:video", "message:animation", "message:document", "message:sticker"], async (ctx, next) => {
        const chatId = ctx.chat.id;
        const userId = ctx.from?.id;
        const msgId = ctx.message?.message_id;

        loggerUtil.debug(`[nsfw-monitor] 📥 Media received - Chat: ${chatId}, User: ${userId}, MsgId: ${msgId}`);

        if (ctx.chat.type === 'private') {
            loggerUtil.debug(`[nsfw-monitor] ⏭️ Skipping: private chat`);
            return next();
        }

        // Skip admins
        if (await isAdmin(ctx, 'nsfw-monitor')) {
            loggerUtil.debug(`[nsfw-monitor] ⏭️ Skipping: user ${userId} is admin`);
            return next();
        }

        // Config check
        const config = db.getGuildConfig(ctx.chat.id);
        if (!config.nsfw_enabled) {
            loggerUtil.debug(`[nsfw-monitor] ⏭️ Skipping: NSFW monitor disabled for chat ${chatId}`);
            return next();
        }

        // Tier bypass
        if (ctx.userTier !== undefined && ctx.userTier >= (config.nsfw_tier_bypass || 2)) {
            loggerUtil.debug(`[nsfw-monitor] ⏭️ Skipping: user ${userId} has tier ${ctx.userTier} (bypass >= ${config.nsfw_tier_bypass || 2})`);
            return next();
        }

        // Check types enabled
        const isVideo = ctx.message.video || (ctx.message.document && ctx.message.document.mime_type?.startsWith('video'));
        const isGif = ctx.message.animation || (ctx.message.document && ctx.message.document.mime_type === 'image/gif');
        const isPhoto = ctx.message.photo;
        const isSticker = ctx.message.sticker;

        const mediaType = isVideo ? 'VIDEO' : (isGif ? 'GIF' : (isPhoto ? 'PHOTO' : (isSticker ? 'STICKER' : 'UNKNOWN')));
        loggerUtil.info(`[nsfw-monitor] 🎬 Media type detected: ${mediaType} - Chat: ${chatId}, User: ${userId}`);

        // Skip animated stickers (they're Lottie files, not images)
        if (isSticker && ctx.message.sticker.is_animated) {
            loggerUtil.debug(`[nsfw-monitor] ⏭️ Skipping: animated sticker (not analyzable)`);
            return next();
        }

        if (isVideo && !config.nsfw_check_videos) {
            loggerUtil.debug(`[nsfw-monitor] ⏭️ Skipping: video check disabled`);
            return next();
        }
        if (isGif && !config.nsfw_check_gifs) {
            loggerUtil.debug(`[nsfw-monitor] ⏭️ Skipping: GIF check disabled`);
            return next();
        }
        if (isPhoto && !config.nsfw_check_photos) {
            loggerUtil.debug(`[nsfw-monitor] ⏭️ Skipping: photo check disabled`);
            return next();
        }
        // Stickers have their own check
        if (isSticker && !config.nsfw_check_stickers) {
            loggerUtil.debug(`[nsfw-monitor] ⏭️ Skipping: sticker check disabled`);
            return next();
        }

        loggerUtil.info(`[nsfw-monitor] ✅ Proceeding with analysis for ${mediaType} - Chat: ${chatId}, User: ${userId}`);

        // Download and analyze
        // Fire and forget to avoid blocking, but handle errors
        processMedia(ctx, config).catch(err => loggerUtil.error(`[nsfw-monitor] ❌ Process error: ${err.message}\n${err.stack}`));

        await next();
    });

    // Command: /nsfwconfig
    bot.command("nsfwconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        if (!await isAdmin(ctx, 'nsfw-monitor')) return;

        await sendConfigUI(ctx);
    });

    // UI Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("nsf_")) return next();

        const config = db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

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
            const type = data.split('_')[2]; // photo, video, gif, sticker
            const key = `nsfw_check_${type}s`;
            if (config[key] !== undefined) {
                db.updateGuildConfig(ctx.chat.id, { [key]: config[key] ? 0 : 1 });
            }
        } else if (data === "nsf_tier") {
            // Cycle through 0, 1, 2, 3
            const current = config.nsfw_tier_bypass ?? 2;
            const next = (current + 1) % 4;
            db.updateGuildConfig(ctx.chat.id, { nsfw_tier_bypass: next });
        }

        await sendConfigUI(ctx, true, fromSettings);
    });
}

async function processMedia(ctx, config) {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id;
    const startTime = Date.now();

    loggerUtil.info(`[nsfw-monitor] 🔄 Starting processMedia - Chat: ${chatId}, User: ${userId}`);

    let fileId;
    let type = 'photo';
    let fileSize = 0;

    if (ctx.message.photo) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        fileId = photo.file_id;
        fileSize = photo.file_size || 0;
        loggerUtil.debug(`[nsfw-monitor] 📷 Photo detected - Size: ${fileSize} bytes, Dimensions: ${photo.width}x${photo.height}`);
    } else if (ctx.message.video) {
        fileId = ctx.message.video.file_id;
        type = 'video';
        fileSize = ctx.message.video.file_size || 0;
        loggerUtil.debug(`[nsfw-monitor] 🎥 Video detected - Size: ${fileSize} bytes, Duration: ${ctx.message.video.duration}s`);
    } else if (ctx.message.animation) {
        fileId = ctx.message.animation.file_id;
        type = 'gif';
        fileSize = ctx.message.animation.file_size || 0;
        loggerUtil.debug(`[nsfw-monitor] 🎞️ Animation/GIF detected - Size: ${fileSize} bytes`);
    } else if (ctx.message.document) {
        fileId = ctx.message.document.file_id;
        fileSize = ctx.message.document.file_size || 0;
        loggerUtil.debug(`[nsfw-monitor] 📄 Document detected - MIME: ${ctx.message.document.mime_type}, Size: ${fileSize} bytes`);
        if (ctx.message.document.mime_type?.startsWith('video')) type = 'video';
        else if (ctx.message.document.mime_type?.startsWith('image')) type = 'photo';
        else {
            loggerUtil.debug(`[nsfw-monitor] ⏭️ Document is not image/video, skipping`);
            return;
        }
    } else if (ctx.message.sticker) {
        // Static stickers are webp images, video stickers are webm
        const sticker = ctx.message.sticker;
        fileId = sticker.file_id;
        fileSize = sticker.file_size || 0;
        loggerUtil.debug(`[nsfw-monitor] 🪙 Sticker detected - Size: ${fileSize} bytes, is_video: ${sticker.is_video}`);
        type = sticker.is_video ? 'gif' : 'photo';
    }

    loggerUtil.info(`[nsfw-monitor] 📁 Getting file info from Telegram - FileId: ${fileId?.substring(0, 20)}...`);
    const file = await ctx.api.getFile(fileId);
    loggerUtil.debug(`[nsfw-monitor] 📁 File path: ${file.file_path}`);

    const downloadUrl = `https://api.telegram.org/file/bot***/${file.file_path}`;
    const ext = path.extname(file.file_path) || (type === 'video' ? '.mp4' : '.jpg');
    const localPath = path.join(TEMP_DIR, `${file.file_unique_id}${ext}`);

    loggerUtil.info(`[nsfw-monitor] ⬇️ Downloading file to: ${localPath}`);
    const downloadStart = Date.now();
    await downloadFile(downloadUrl.replace('***', process.env.BOT_TOKEN), localPath);
    const downloadTime = Date.now() - downloadStart;

    const actualSize = fs.statSync(localPath).size;
    loggerUtil.info(`[nsfw-monitor] ✅ Download complete - Size: ${actualSize} bytes, Time: ${downloadTime}ms`);

    try {
        let isNsfw = false;
        let reasons = [];

        if (type === 'video' || type === 'gif') {
            loggerUtil.info(`[nsfw-monitor] 🎬 Starting VIDEO/GIF analysis...`);
            isNsfw = await checkVideo(localPath, config, reasons);
        } else {
            loggerUtil.info(`[nsfw-monitor] 🖼️ Starting IMAGE analysis...`);
            isNsfw = await checkImage(localPath, config, reasons);
        }

        const totalTime = Date.now() - startTime;
        if (isNsfw) {
            loggerUtil.warn(`[nsfw-monitor] 🚨 NSFW DETECTED - Chat: ${chatId}, User: ${userId}, Reason: ${reasons[0]}, TotalTime: ${totalTime}ms`);
            await executeAction(ctx, config.nsfw_action || 'delete', reasons[0], type);
        } else {
            loggerUtil.info(`[nsfw-monitor] ✅ Content is SAFE - Chat: ${chatId}, User: ${userId}, TotalTime: ${totalTime}ms`);
        }
    } finally {
        // Cleanup main file
        loggerUtil.debug(`[nsfw-monitor] 🧹 Cleaning up temp file: ${localPath}`);
        try { fs.unlinkSync(localPath); } catch (e) { }
    }
}

async function downloadFile(url, dest) {
    loggerUtil.debug(`[nsfw-monitor] ⬇️ downloadFile: Starting download to ${dest}`);
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            loggerUtil.debug(`[nsfw-monitor] ⬇️ downloadFile: Got response, status: ${response.statusCode}`);
            response.pipe(file);
            file.on('finish', () => {
                loggerUtil.debug(`[nsfw-monitor] ⬇️ downloadFile: File write finished`);
                file.close(resolve);
            });
        }).on('error', (err) => {
            loggerUtil.error(`[nsfw-monitor] ❌ downloadFile: Error - ${err.message}`);
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
}

async function checkImage(imagePath, config, reasons) {
    loggerUtil.debug(`[nsfw-monitor] 🖼️ checkImage: Reading file ${imagePath}`);
    const buffer = fs.readFileSync(imagePath);
    const base64 = buffer.toString('base64');
    const base64Size = Math.round(base64.length / 1024);
    loggerUtil.debug(`[nsfw-monitor] 🖼️ checkImage: Base64 size: ${base64Size}KB`);

    loggerUtil.info(`[nsfw-monitor] 🤖 Sending image to Vision LLM for analysis...`);
    const llmStart = Date.now();
    const res = await callVisionLLM(base64, config);
    const llmTime = Date.now() - llmStart;

    loggerUtil.info(`[nsfw-monitor] 🤖 LLM Response (${llmTime}ms): nsfw=${res.nsfw}, category=${res.category}, confidence=${res.confidence}, reason=${res.reason || 'N/A'}`);

    const threshold = config.nsfw_threshold || 0.7;
    if (res.nsfw && res.confidence >= threshold) {
        loggerUtil.warn(`[nsfw-monitor] ⚠️ NSFW threshold exceeded: ${res.confidence} >= ${threshold}`);
        reasons.push(`${res.category} (${Math.round(res.confidence * 100)}%)`);
        return true;
    }
    loggerUtil.debug(`[nsfw-monitor] ✅ Image passed check (confidence ${res.confidence} < threshold ${threshold})`);
    return false;
}

async function checkVideo(videoPath, config, reasons) {
    loggerUtil.info(`[nsfw-monitor] 🎬 checkVideo: Analyzing ${videoPath}`);

    // Get duration
    loggerUtil.debug(`[nsfw-monitor] 🎬 Getting video duration...`);
    const duration = await getVideoDuration(videoPath);
    if (!duration) {
        loggerUtil.warn(`[nsfw-monitor] ⚠️ Could not get video duration, skipping analysis`);
        return false;
    }
    loggerUtil.info(`[nsfw-monitor] 🎬 Video duration: ${duration.toFixed(2)}s`);

    // Extract frames: every 5%
    const intervalPct = config.nsfw_frame_interval_percent || 5;
    const timestamps = [];
    for (let pct = intervalPct; pct < 100; pct += intervalPct) {
        timestamps.push((pct / 100) * duration);
    }

    // Safety cap: max 20 frames
    if (timestamps.length > 20) {
        loggerUtil.debug(`[nsfw-monitor] 🎬 Capping timestamps from ${timestamps.length} to 20`);
        timestamps.length = 20;
    }

    loggerUtil.info(`[nsfw-monitor] 🎬 Will extract ${timestamps.length} frames at ${intervalPct}% intervals`);

    for (let i = 0; i < timestamps.length; i++) {
        const ts = timestamps[i];
        const framePath = path.join(TEMP_DIR, `frame_${path.basename(videoPath)}_${ts}.jpg`);
        loggerUtil.debug(`[nsfw-monitor] 🎬 Processing frame ${i + 1}/${timestamps.length} at ${ts.toFixed(2)}s`);

        try {
            loggerUtil.debug(`[nsfw-monitor] 🎬 Extracting frame at ${ts.toFixed(2)}s to ${framePath}`);
            const extractStart = Date.now();
            await extractFrame(videoPath, ts, framePath);
            loggerUtil.debug(`[nsfw-monitor] 🎬 Frame extracted in ${Date.now() - extractStart}ms`);

            const isNsfw = await checkImage(framePath, config, reasons);

            loggerUtil.debug(`[nsfw-monitor] 🧹 Cleaning up frame: ${framePath}`);
            fs.unlinkSync(framePath);

            if (isNsfw) {
                reasons[0] += ` @ ${ts.toFixed(1)}s`;
                loggerUtil.warn(`[nsfw-monitor] 🚨 NSFW detected at frame ${i + 1} (${ts.toFixed(1)}s) - stopping early`);
                return true;
            }
        } catch (e) {
            loggerUtil.warn(`[nsfw-monitor] ⚠️ Frame ${i + 1} check error: ${e.message}`);
        }
    }

    loggerUtil.info(`[nsfw-monitor] ✅ All ${timestamps.length} frames passed check`);
    return false;
}

function getVideoDuration(filePath) {
    return new Promise((resolve) => {
        loggerUtil.debug(`[nsfw-monitor] 🎬 ffprobe: Getting duration for ${filePath}`);
        fluentFfmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                loggerUtil.error(`[nsfw-monitor] ❌ ffprobe error: ${err.message}`);
                resolve(0);
            } else {
                loggerUtil.debug(`[nsfw-monitor] 🎬 ffprobe: Duration = ${metadata.format.duration}s, Format = ${metadata.format.format_name}`);
                resolve(metadata.format.duration);
            }
        });
    });
}

function extractFrame(videoPath, timestamp, outputPath) {
    return new Promise((resolve, reject) => {
        loggerUtil.debug(`[nsfw-monitor] 🎬 ffmpeg: Extracting frame at ${timestamp}s from ${videoPath}`);
        fluentFfmpeg(videoPath)
            .seekInput(timestamp)
            .frames(1)
            .output(outputPath)
            .on('end', () => {
                loggerUtil.debug(`[nsfw-monitor] 🎬 ffmpeg: Frame extracted successfully`);
                resolve();
            })
            .on('error', (err) => {
                loggerUtil.error(`[nsfw-monitor] ❌ ffmpeg error: ${err.message}`);
                reject(err);
            })
            .run();
    });
}

async function callVisionLLM(base64Image, config) {
    const url = process.env.LM_STUDIO_URL || 'http://localhost:1234';
    loggerUtil.debug(`[nsfw-monitor] 🤖 callVisionLLM: Connecting to ${url}`);

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
        const timeout = setTimeout(() => {
            loggerUtil.warn(`[nsfw-monitor] ⏰ LLM request timeout (60s)`);
            controller.abort();
        }, 60000);

        loggerUtil.debug(`[nsfw-monitor] 🤖 Sending request to LLM API...`);
        const requestStart = Date.now();

        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: process.env.LM_STUDIO_NSFW_MODEL || undefined, // Use specific vision model if set
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

        const responseTime = Date.now() - requestStart;
        loggerUtil.debug(`[nsfw-monitor] 🤖 LLM response received in ${responseTime}ms, status: ${response.status}`);

        if (!response.ok) {
            loggerUtil.error(`[nsfw-monitor] ❌ LLM API error: status ${response.status}`);
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;
        loggerUtil.debug(`[nsfw-monitor] 🤖 LLM raw response: ${content}`);

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        let result;
        if (jsonMatch) {
            result = JSON.parse(jsonMatch[0]);
        } else {
            result = JSON.parse(content);
        }

        loggerUtil.debug(`[nsfw-monitor] 🤖 LLM parsed result: ${JSON.stringify(result)}`);
        return result;

    } catch (e) {
        if (e.name === 'AbortError') {
            loggerUtil.error(`[nsfw-monitor] ❌ LLM request aborted (timeout)`);
        } else {
            loggerUtil.error(`[nsfw-monitor] ❌ LLM error: ${e.message}`);
        }
        loggerUtil.debug(`[nsfw-monitor] 🤖 Returning safe default due to error`);
        return { nsfw: false, category: "safe", confidence: 1, reason: "LLM error - defaulting to safe" };
    }
}

async function executeAction(ctx, action, reason, type) {
    const user = ctx.from;

    // Determine eventType based on action
    const eventType = action === 'ban' ? 'nsfw_ban' : 'nsfw_delete';

    const logParams = {
        guildId: ctx.chat.id,
        eventType: eventType,
        targetUser: user,
        reason: `NSFW (${type}): ${reason}`,
        isGlobal: (action === 'ban')
    };

    if (action === 'delete') {
        // Forward original media to Parliament BEFORE deleting
        if (superAdmin.forwardMediaToParliament) {
            const caption = `🖼️ NSFW Detected\n\nGruppo: ${ctx.chat.title}\nUser: ${user.first_name} (@${user.username || 'N/A'})\nUser ID: ${user.id}\nResult: ${reason}\nAction: DELETE`;
            await superAdmin.forwardMediaToParliament('image_spam', ctx, caption);
        }

        await safeDelete(ctx, 'nsfw-monitor');
        if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
    }
    else if (action === 'ban') {
        // Forward original media to Parliament BEFORE deleting
        if (superAdmin.forwardMediaToParliament) {
            const caption = `🖼️ NSFW Detected + BAN\n\nGruppo: ${ctx.chat.title}\nUser: ${user.first_name} (@${user.username || 'N/A'})\nUser ID: ${user.id}\nResult: ${reason}\nAction: BAN`;
            await superAdmin.forwardMediaToParliament('image_spam', ctx, caption);
        }

        await safeDelete(ctx, 'nsfw-monitor');
        const banned = await safeBan(ctx, user.id, 'nsfw-monitor');

        if (banned) {
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
        }
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
    loggerUtil.debug(`[nsfw-monitor] sendConfigUI called - isEdit: ${isEdit}, fromSettings: ${fromSettings}, chatId: ${ctx.chat?.id}`);

    try {
        const config = db.getGuildConfig(ctx.chat.id);
        const enabled = config.nsfw_enabled ? '✅ ON' : '❌ OFF';
        const action = (config.nsfw_action || 'delete').toUpperCase();
        const thr = (config.nsfw_threshold || 0.7) * 100;
        const tierBypass = config.nsfw_tier_bypass ?? 2;

        // Toggles
        const p = config.nsfw_check_photos ? '✅' : '❌';
        const v = config.nsfw_check_videos ? '✅' : '❌';
        const g = config.nsfw_check_gifs ? '✅' : '❌';
        const s = config.nsfw_check_stickers ? '✅' : '❌';

        const text = `🔞 <b>FILTRO NSFW</b>\n\n` +
            `Analizza immagini e video per trovare contenuti non adatti (Nudo, Violenza).\n` +
            `Protegge il gruppo da contenuti scioccanti.\n\n` +
            `ℹ️ <b>Info:</b>\n` +
            `• Funziona su Foto, Video, GIF e Sticker\n` +
            `• Blocca pornografia e immagini violente\n` +
            `• Richiede un po' di tempo per analizzare i video\n\n` +
            `Stato: ${enabled}\n` +
            `Bypass da Tier: ${tierBypass}+\n` +
            `Azione: ${action}\n` +
            `Sensibilità: ${thr}%\n` +
            `Controlla: Foto ${p} | Video ${v} | GIF ${g} | Sticker ${s}`;

        const closeBtn = fromSettings
            ? { text: "🔙 Back", callback_data: "settings_main" }
            : { text: "❌ Chiudi", callback_data: "nsf_close" };

        const keyboard = {
            inline_keyboard: [
                [{ text: `🔞 Monitor: ${enabled}`, callback_data: "nsf_toggle" }],
                [{ text: `👤 Bypass Tier: ${tierBypass}+`, callback_data: "nsf_tier" }],
                [{ text: `👮 Azione: ${action}`, callback_data: "nsf_act" }, { text: `📊 Soglia: ${thr}%`, callback_data: "nsf_thr" }],
                [{ text: `📷 ${p}`, callback_data: "nsf_tog_photo" }, { text: `📹 ${v}`, callback_data: "nsf_tog_video" }],
                [{ text: `🎬 ${g}`, callback_data: "nsf_tog_gif" }, { text: `🪙 ${s}`, callback_data: "nsf_tog_sticker" }],
                [closeBtn]
            ]
        };

        loggerUtil.debug(`[nsfw-monitor] sendConfigUI prepared, isEdit: ${isEdit}`);

        if (isEdit) {
            await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
            loggerUtil.debug(`[nsfw-monitor] sendConfigUI editMessageText completed`);
        } else {
            await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
            loggerUtil.debug(`[nsfw-monitor] sendConfigUI reply completed`);
        }
    } catch (e) {
        loggerUtil.error(`[nsfw-monitor] sendConfigUI error: ${e.message}`);
        // Try to answer callback to prevent loading forever
        try {
            await ctx.answerCallbackQuery(`Errore: ${e.message.substring(0, 50)}`);
        } catch (e2) { }
    }
}

module.exports = { register, sendConfigUI };
