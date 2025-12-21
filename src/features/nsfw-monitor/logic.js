const fs = require('fs');
const path = require('path');
const https = require('https');
const fluentFfmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
fluentFfmpeg.setFfmpegPath(ffmpegPath);
fluentFfmpeg.setFfprobePath(ffprobePath);

const loggerUtil = require('../../middlewares/logger');
const actions = require('./actions');

const TEMP_DIR = path.join(__dirname, 'temp_nsfw');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
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

        // Extract caption if available (photos/videos can have captions)
        const caption = ctx.message.caption || null;
        if (caption) {
            loggerUtil.debug(`[nsfw-monitor] 📝 Caption present: "${caption.substring(0, 50)}..."`);
        }

        if (type === 'video' || type === 'gif') {
            loggerUtil.info(`[nsfw-monitor] 🎬 Starting VIDEO/GIF analysis...`);
            isNsfw = await checkVideo(localPath, config, reasons, caption);
        } else {
            loggerUtil.info(`[nsfw-monitor] 🖼️ Starting IMAGE analysis...`);
            isNsfw = await checkImage(localPath, config, reasons, caption);
        }

        const totalTime = Date.now() - startTime;
        if (isNsfw) {
            loggerUtil.warn(`[nsfw-monitor] 🚨 NSFW DETECTED - Chat: ${chatId}, User: ${userId}, Reason: ${reasons[0]}, TotalTime: ${totalTime}ms`);
            await actions.executeAction(ctx, config.nsfw_action || 'delete', reasons[0], type);
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

async function checkImage(imagePath, config, reasons, caption = null) {
    loggerUtil.debug(`[nsfw-monitor] 🖼️ checkImage: Reading file ${imagePath}`);
    const buffer = fs.readFileSync(imagePath);
    const base64 = buffer.toString('base64');
    const base64Size = Math.round(base64.length / 1024);
    loggerUtil.debug(`[nsfw-monitor] 🖼️ checkImage: Base64 size: ${base64Size}KB`);

    loggerUtil.info(`[nsfw-monitor] 🤖 Sending image to Vision LLM for analysis...`);
    const llmStart = Date.now();
    const res = await callVisionLLM(base64, config, caption);
    const llmTime = Date.now() - llmStart;

    loggerUtil.info(`[nsfw-monitor] 🤖 LLM Response (${llmTime}ms): category=${res.category}, confidence=${res.confidence}, reason=${res.reason || 'N/A'}`);

    // Get blocked categories for this guild
    let blockedCategories = config.nsfw_blocked_categories;
    if (!blockedCategories || !Array.isArray(blockedCategories)) {
        // Parse if it's a JSON string, or use defaults
        try {
            blockedCategories = typeof blockedCategories === 'string'
                ? JSON.parse(blockedCategories)
                : getDefaultBlockedCategories();
        } catch (e) {
            blockedCategories = getDefaultBlockedCategories();
        }
    }

    // Always block minors regardless of config
    if (!blockedCategories.includes('minors')) {
        blockedCategories.push('minors');
    }

    const threshold = config.nsfw_threshold || 0.7;
    const isBlocked = blockedCategories.includes(res.category);

    if (isBlocked && res.confidence >= threshold) {
        const categoryInfo = NSFW_CATEGORIES[res.category] || { name: res.category };
        loggerUtil.warn(`[nsfw-monitor] ⚠️ Blocked category detected: ${res.category} (${res.confidence} >= ${threshold})`);
        reasons.push(`${categoryInfo.name} (${Math.round(res.confidence * 100)}%)`);
        return true;
    }

    loggerUtil.debug(`[nsfw-monitor] ✅ Image passed check - category: ${res.category}, blocked: ${isBlocked}, confidence: ${res.confidence}`);
    return false;
}

async function checkVideo(videoPath, config, reasons, caption = null) {
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

            const isNsfw = await checkImage(framePath, config, reasons, caption);

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

/**
 * All available NSFW categories with descriptions
 */
const NSFW_CATEGORIES = {
    safe: { name: 'Safe', description: 'Normal, appropriate content', blockable: false },
    suggestive: { name: 'Suggestive', description: 'Revealing clothing, provocative poses', blockable: true },
    ecchi: { name: 'Ecchi/Sexy Anime', description: 'Anime/manga with sexy but non-explicit content', blockable: true },
    figures_nsfw: { name: 'NSFW Figures', description: 'Action figures/statues with nudity or sexual themes', blockable: true },
    real_nudity: { name: 'Real Nudity', description: 'Photographic/realistic human nudity', blockable: true },
    real_sex: { name: 'Real Sex', description: 'Photographic/realistic sexual acts', blockable: true },
    hentai: { name: 'Hentai', description: 'Explicit anime/manga sexual content', blockable: true },
    gore: { name: 'Gore/Violence', description: 'Blood, injuries, graphic violence', blockable: true },
    minors: { name: 'Minors (CSAM)', description: 'Any sexualized content involving minors', blockable: false, alwaysBlocked: true }
};

/**
 * Get default blocked categories
 */
function getDefaultBlockedCategories() {
    return ['real_nudity', 'real_sex', 'hentai', 'gore', 'minors'];
}

async function callVisionLLM(base64Image, config, caption = null) {
    const url = process.env.LM_STUDIO_URL || 'http://localhost:1234';
    loggerUtil.debug(`[nsfw-monitor] 🤖 callVisionLLM: Connecting to ${url}`);

    // Build category list for prompt
    const categoryList = Object.entries(NSFW_CATEGORIES)
        .map(([key, val]) => `- "${key}": ${val.description}`)
        .join('\n');

    const systemPrompt = `You are an image content classifier. Analyze this image and classify it into ONE of these categories.

CATEGORIES:
${categoryList}

IMPORTANT RULES:
- "minors" takes absolute priority - if ANY sexualized content involves minors, classify as "minors"
- Distinguish between real photography and anime/cartoon/3D rendered content
- Action figures and statues go in "figures_nsfw" if they show nudity/sexual themes
- "ecchi" is for anime that's sexy but NOT explicit (no exposed genitals)
- "hentai" is for anime with explicit sexual content

Respond ONLY with a JSON object:
{"category": "...", "confidence": 0.0-1.0, "reason": "brief explanation"}`;

    // Build user message with optional caption context
    let userMessage = "Classify this image.";
    if (caption && caption.trim()) {
        userMessage = `Classify this image. The uploader's caption was: "${caption.substring(0, 200)}"`;
    }

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
                model: process.env.LM_STUDIO_NSFW_MODEL || undefined,
                messages: [
                    { role: "system", content: systemPrompt },
                    {
                        role: "user", content: [
                            { type: "text", text: userMessage },
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

        // Normalize category to known values
        if (!NSFW_CATEGORIES[result.category]) {
            loggerUtil.warn(`[nsfw-monitor] Unknown category "${result.category}", defaulting to safe`);
            result.category = 'safe';
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
        return { category: "safe", confidence: 1, reason: "LLM error - defaulting to safe" };
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
    processMedia,
    testConnection,
    NSFW_CATEGORIES,
    getDefaultBlockedCategories
};
