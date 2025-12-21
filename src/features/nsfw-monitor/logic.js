const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const fluentFfmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
fluentFfmpeg.setFfmpegPath(ffmpegPath);
fluentFfmpeg.setFfprobePath(ffprobePath);

const logger = require('../../middlewares/logger');
const actions = require('./actions');

const TEMP_DIR = path.join(process.cwd(), 'temp', 'nsfw');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

async function processMedia(ctx, config) {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id;
    const startTime = Date.now();

    logger.info(`[nsfw-monitor] 🔄 Starting processMedia - Chat: ${chatId}, User: ${userId}`);

    let fileId;
    let type = 'photo';
    let fileSize = 0;

    if (ctx.message.photo) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        fileId = photo.file_id;
        fileSize = photo.file_size || 0;
        logger.debug(`[nsfw-monitor] 📷 Photo detected - Size: ${fileSize} bytes, Dimensions: ${photo.width}x${photo.height}`);
    } else if (ctx.message.video) {
        fileId = ctx.message.video.file_id;
        type = 'video';
        fileSize = ctx.message.video.file_size || 0;
        logger.debug(`[nsfw-monitor] 🎥 Video detected - Size: ${fileSize} bytes, Duration: ${ctx.message.video.duration}s`);
    } else if (ctx.message.animation) {
        fileId = ctx.message.animation.file_id;
        type = 'gif';
        fileSize = ctx.message.animation.file_size || 0;
        logger.debug(`[nsfw-monitor] 🎞️ Animation/GIF detected - Size: ${fileSize} bytes`);
    } else if (ctx.message.document) {
        fileId = ctx.message.document.file_id;
        fileSize = ctx.message.document.file_size || 0;
        logger.debug(`[nsfw-monitor] 📄 Document detected - MIME: ${ctx.message.document.mime_type}, Size: ${fileSize} bytes`);
        if (ctx.message.document.mime_type?.startsWith('video')) type = 'video';
        else if (ctx.message.document.mime_type?.startsWith('image')) type = 'photo';
        else {
            logger.debug(`[nsfw-monitor] ⏭️ Document is not image/video, skipping`);
            return;
        }
    } else if (ctx.message.sticker) {
        // Static stickers are webp images, video stickers are webm
        const sticker = ctx.message.sticker;
        fileId = sticker.file_id;
        fileSize = sticker.file_size || 0;
        logger.debug(`[nsfw-monitor] 🪙 Sticker detected - Size: ${fileSize} bytes, is_video: ${sticker.is_video}`);
        type = sticker.is_video ? 'gif' : 'photo';
    }

    logger.info(`[nsfw-monitor] 📁 Getting file info from Telegram - FileId: ${fileId?.substring(0, 20)}...`);

    // SAFETY CHECK: Skip large files or long videos BEFORE getFile to avoid API errors
    // If using local API server, limit is 2000MB via HTTP, otherwise 20MB
    const IS_LOCAL_API = !!process.env.TELEGRAM_API_URL;
    const MAX_FILE_SIZE = IS_LOCAL_API ? 2000 * 1024 * 1024 : 20 * 1024 * 1024;
    const MAX_VIDEO_DURATION = 300; // 5 minutes

    if (fileSize > MAX_FILE_SIZE) {
        logger.warn(`[nsfw-monitor] ⚠️ File too large (${(fileSize / 1024 / 1024).toFixed(2)} MB), limit is ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)} MB. Skipping analysis.`);
        return;
    }

    if (type === 'video' && ctx.message.video?.duration > MAX_VIDEO_DURATION) {
        logger.warn(`[nsfw-monitor] ⚠️ Video too long (${(ctx.message.video.duration / 60).toFixed(1)} min), skipping analysis`);
        return;
    }

    let file;
    try {
        file = await ctx.api.getFile(fileId);
    } catch (err) {
        // Handle "file is too big" error specifically
        if (err.description && err.description.includes('file is too big')) {
            logger.warn(`[nsfw-monitor] ⚠️ Telegram API Error: File is too big to download via Cloud API. Consider using Local API Server.`);
            return;
        }
        // Re-throw other errors or log and return
        logger.error(`[nsfw-monitor] ❌ Error getting file info: ${err.message}`);
        return;
    }

    logger.debug(`[nsfw-monitor] 📁 File path: ${file.file_path}`);

    // Construct download URL or local path
    let downloadUrl;
    let directLocalPath = null;

    if (IS_LOCAL_API) {
        // Local API Server
        const baseUrl = process.env.TELEGRAM_API_URL;

        // The path from getFile is absolute inside the container (e.g. /var/lib/telegram-bot-api/TOKEN/videos/file.mp4)
        // We need to map this to our host local path: ./telegram-bot-api-data/TOKEN/videos/file.mp4

        // Check if we can access the file directly on disk
        // The container maps ./telegram-bot-api-data:/var/lib/telegram-bot-api
        // So /var/lib/telegram-bot-api/... becomes ./telegram-bot-api-data/...

        if (file.file_path.startsWith('/var/lib/telegram-bot-api/')) {
            const relativePath = file.file_path.replace('/var/lib/telegram-bot-api/', '');
            const mappedPath = path.join(process.cwd(), 'telegram-bot-api-data', relativePath);

            if (fs.existsSync(mappedPath)) {
                directLocalPath = mappedPath;
                logger.debug(`[nsfw-monitor] 📂 Local API detected, found direct file at: ${mappedPath}`);
            }
        }

        // Fallback or if path structure is different: try to fix path for HTTP download
        if (!directLocalPath) {
            // Fix for local API returning absolute paths (e.g. /var/lib/.../botTOKEN/videos/file.mp4)
            // We need the relative path (videos/file.mp4) to construct the HTTP URL
            if (file.file_path.startsWith('/')) {
                const tokenIndex = file.file_path.indexOf(process.env.BOT_TOKEN);
                if (tokenIndex !== -1) {
                    // substring from end of token + 1 (for the separator slash)
                    file.file_path = file.file_path.substring(tokenIndex + process.env.BOT_TOKEN.length + 1);
                }
            }
            downloadUrl = `${baseUrl}/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
        }

    } else {
        // Cloud API
        downloadUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    }

    const ext = path.extname(file.file_path) || (type === 'video' ? '.mp4' : '.jpg');
    const localPath = path.join(TEMP_DIR, `${file.file_unique_id}${ext}`);

    const downloadStart = Date.now();
    try {
        if (directLocalPath) {
            logger.info(`[nsfw-monitor] 📂 Copying file from local storage: ${directLocalPath} -> ${localPath}`);
            fs.copyFileSync(directLocalPath, localPath);
        } else {
            logger.info(`[nsfw-monitor] ⬇️ Downloading file to: ${localPath} (Source: ${IS_LOCAL_API ? 'Local API' : 'Cloud API'})`);
            logger.info(`[nsfw-monitor] 🔗 Download URL: ${downloadUrl}`);
            await downloadFile(downloadUrl, localPath);
        }
    } catch (e) {
        logger.error(`[nsfw-monitor] ❌ Download/Copy failed: ${e.message}`);
        return false;
    }
    const downloadTime = Date.now() - downloadStart;

    const actualSize = fs.statSync(localPath).size;
    logger.info(`[nsfw-monitor] ✅ File ready - Size: ${actualSize} bytes, Time: ${downloadTime}ms`);

    try {
        let isNsfw = false;
        let reasons = [];

        // Extract caption if available (photos/videos can have captions)
        const caption = ctx.message.caption || null;
        if (caption) {
            logger.debug(`[nsfw-monitor] 📝 Caption present: "${caption.substring(0, 50)}..."`);
        }

        if (type === 'video' || type === 'gif') {
            logger.info(`[nsfw-monitor] 🎬 Starting VIDEO/GIF analysis...`);
            isNsfw = await checkVideo(localPath, config, reasons, caption);
        } else {
            logger.info(`[nsfw-monitor] 🖼️ Starting IMAGE analysis...`);
            isNsfw = await checkImage(localPath, config, reasons, caption);
        }

        const totalTime = Date.now() - startTime;
        if (isNsfw) {
            logger.warn(`[nsfw-monitor] 🚨 NSFW DETECTED - Chat: ${chatId}, User: ${userId}, Reason: ${reasons[0]}, TotalTime: ${totalTime}ms`);
            await actions.executeAction(ctx, config.nsfw_action || 'delete', reasons[0], type);
        } else {
            logger.info(`[nsfw-monitor] ✅ Content is SAFE - Chat: ${chatId}, User: ${userId}, TotalTime: ${totalTime}ms`);
        }
    } finally {
        // Cleanup main file
        logger.debug(`[nsfw-monitor] 🧹 Cleaning up temp file: ${localPath}`);
        try { fs.unlinkSync(localPath); } catch (e) { }
    }
}

async function downloadFile(url, dest) {
    logger.debug(`[nsfw-monitor] ⬇️ downloadFile: Starting download to ${dest}`);
    const client = url.startsWith('http:') ? http : https;

    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        client.get(url, (response) => {
            logger.debug(`[nsfw-monitor] ⬇️ downloadFile: Got response, status: ${response.statusCode}`);
            response.pipe(file);
            file.on('finish', () => {
                logger.debug(`[nsfw-monitor] ⬇️ downloadFile: File write finished`);
                file.close(resolve);
            });
        }).on('error', (err) => {
            logger.error(`[nsfw-monitor] ❌ downloadFile: Error - ${err.message}`);
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
}

async function checkImage(imagePath, config, reasons, caption = null) {
    logger.debug(`[nsfw-monitor] 🖼️ checkImage: Reading file ${imagePath}`);
    const buffer = fs.readFileSync(imagePath);
    const base64 = buffer.toString('base64');
    const base64Size = Math.round(base64.length / 1024);
    logger.debug(`[nsfw-monitor] 🖼️ checkImage: Base64 size: ${base64Size}KB`);

    logger.info(`[nsfw-monitor] 🤖 Sending image to Vision LLM for analysis...`);
    const llmStart = Date.now();
    const res = await callVisionLLM(base64, config, caption);
    const llmTime = Date.now() - llmStart;

    logger.info(`[nsfw-monitor] 🤖 LLM Response (${llmTime}ms): category=${res.category}, confidence=${res.confidence}, reason=${res.reason || 'N/A'}`);

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
        logger.warn(`[nsfw-monitor] ⚠️ Blocked category detected: ${res.category} (${res.confidence} >= ${threshold})`);
        reasons.push(`${categoryInfo.name} (${Math.round(res.confidence * 100)}%)`);
        return true;
    }

    logger.debug(`[nsfw-monitor] ✅ Image passed check - category: ${res.category}, blocked: ${isBlocked}, confidence: ${res.confidence}`);
    return false;
}

async function checkVideo(videoPath, config, reasons, caption = null) {
    logger.info(`[nsfw-monitor] 🎬 checkVideo: Analyzing ${videoPath}`);

    // Get duration
    logger.debug(`[nsfw-monitor] 🎬 Getting video duration...`);
    const duration = await getVideoDuration(videoPath);
    if (!duration) {
        logger.warn(`[nsfw-monitor] ⚠️ Could not get video duration, skipping analysis`);
        return false;
    }
    logger.info(`[nsfw-monitor] 🎬 Video duration: ${duration.toFixed(2)}s`);

    // LIMIT: Skip videos longer than 5 minutes
    const MAX_DURATION = 300; // 5 minutes in seconds
    if (duration > MAX_DURATION) {
        logger.warn(`[nsfw-monitor] ⚠️ Video too long (${(duration / 60).toFixed(1)} min > 5 min), skipping analysis`);
        return false;
    }

    // Calculate number of frames to extract
    // - Short videos (<5s): high density, ~2 frames/sec
    // - Medium videos (5-60s): ~0.5 frames/sec  
    // - Long videos (60-300s): ~0.2 frames/sec
    const MIN_FRAMES = 10;
    const MAX_FRAMES = 50;

    let targetFrames;
    if (duration <= 5) {
        targetFrames = Math.ceil(duration * 2); // 2 frames/sec
    } else if (duration <= 60) {
        targetFrames = Math.ceil(duration * 0.5); // 0.5 frames/sec
    } else {
        targetFrames = Math.ceil(duration * 0.2); // 0.2 frames/sec
    }

    // Clamp between min and max
    targetFrames = Math.max(MIN_FRAMES, Math.min(targetFrames, MAX_FRAMES));

    // Adjust if video is shorter than MIN_FRAMES seconds (can't have more frames than duration in seconds)
    const actualFrames = Math.min(targetFrames, Math.floor(duration));

    logger.info(`[nsfw-monitor] 🎬 Duration: ${duration.toFixed(1)}s → Extracting ${actualFrames} frames uniformly`);

    // Generate uniform timestamps
    const timestamps = [];
    if (actualFrames >= 1) {
        const step = duration / (actualFrames + 1);
        for (let i = 1; i <= actualFrames; i++) {
            timestamps.push(step * i);
        }
    }

    // Generate frame paths
    const framePaths = timestamps.map((ts, i) => ({
        path: path.join(TEMP_DIR, `frame_${path.basename(videoPath)}_${i}.jpg`),
        timestamp: ts
    }));

    // Extract all frames in parallel
    logger.info(`[nsfw-monitor] ⚡ Extracting ${timestamps.length} frames in parallel...`);
    const extractStart = Date.now();

    const extractResults = await Promise.allSettled(
        timestamps.map((ts, i) => extractFrame(videoPath, ts, framePaths[i].path))
    );

    // Filter successful extractions
    const validFrames = framePaths.filter((f, i) =>
        extractResults[i].status === 'fulfilled' && fs.existsSync(f.path)
    );

    logger.info(`[nsfw-monitor] ⚡ Extraction complete: ${validFrames.length}/${timestamps.length} frames in ${Date.now() - extractStart}ms`);

    if (validFrames.length === 0) {
        logger.warn(`[nsfw-monitor] ⚠️ No frames extracted successfully`);
        return false;
    }

    logger.info(`[nsfw-monitor] 🎬 Final frame count: ${validFrames.length}`);

    // Batch frames for LLM analysis
    const BATCH_SIZE = parseInt(process.env.LM_STUDIO_BATCH_SIZE) || 5;
    const batches = [];
    for (let i = 0; i < validFrames.length; i += BATCH_SIZE) {
        batches.push(validFrames.slice(i, i + BATCH_SIZE));
    }

    logger.info(`[nsfw-monitor] 🤖 Analyzing ${validFrames.length} frames in ${batches.length} batches (${BATCH_SIZE} per batch)...`);

    try {
        for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
            const batch = batches[batchIdx];
            logger.info(`[nsfw-monitor] 🤖 Batch ${batchIdx + 1}/${batches.length}: Analyzing ${batch.length} frames...`);

            // Read all frames in batch to base64
            const base64Images = batch.map(f => {
                const buffer = fs.readFileSync(f.path);
                return buffer.toString('base64');
            });

            // Call LLM with all images in batch
            const batchStart = Date.now();
            const result = await callVisionLLMBatch(base64Images, config, caption, batch.map(f => f.timestamp));
            logger.info(`[nsfw-monitor] 🤖 Batch ${batchIdx + 1} analyzed in ${Date.now() - batchStart}ms`);

            // Check result
            if (result.isNsfw) {
                reasons.push(result.reason);
                logger.warn(`[nsfw-monitor] 🚨 NSFW detected in batch ${batchIdx + 1}: ${result.reason}`);
                return true;
            }
        }

        logger.info(`[nsfw-monitor] ✅ All ${batches.length} batches passed check`);
        return false;

    } finally {
        // Cleanup all frame files
        logger.debug(`[nsfw-monitor] 🧹 Cleaning up ${validFrames.length} frame files...`);
        for (const frame of validFrames) {
            try { fs.unlinkSync(frame.path); } catch (e) { }
        }
    }
}



function getVideoDuration(filePath) {
    return new Promise((resolve) => {
        logger.debug(`[nsfw-monitor] 🎬 ffprobe: Getting duration for ${filePath}`);
        fluentFfmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                logger.error(`[nsfw-monitor] ❌ ffprobe error: ${err.message}`);
                resolve(0);
            } else {
                logger.debug(`[nsfw-monitor] 🎬 ffprobe: Duration = ${metadata.format.duration}s, Format = ${metadata.format.format_name}`);
                resolve(metadata.format.duration);
            }
        });
    });
}

function extractFrame(videoPath, timestamp, outputPath) {
    return new Promise((resolve, reject) => {
        logger.debug(`[nsfw-monitor] 🎬 ffmpeg: Extracting frame at ${timestamp}s from ${videoPath}`);
        fluentFfmpeg(videoPath)
            .seekInput(timestamp)
            .frames(1)
            .output(outputPath)
            .on('end', () => {
                logger.debug(`[nsfw-monitor] 🎬 ffmpeg: Frame extracted successfully`);
                resolve();
            })
            .on('error', (err) => {
                logger.error(`[nsfw-monitor] ❌ ffmpeg error: ${err.message}`);
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
    real_gore: { name: 'Real Gore', description: 'Photographic blood, injuries, graphic violence', blockable: true },
    drawn_gore: { name: 'Drawn Gore', description: 'Stylized/anime blood, injuries, graphic violence', blockable: true },
    minors: { name: 'Minors (CSAM)', description: 'Any sexualized content involving minors', blockable: false, alwaysBlocked: true }
};

/**
 * Get default blocked categories
 */
function getDefaultBlockedCategories() {
    return ['real_nudity', 'real_sex', 'hentai', 'real_gore', 'drawn_gore', 'minors'];
}

async function callVisionLLM(base64Image, config, caption = null) {
    const url = process.env.LM_STUDIO_URL || 'http://localhost:1234';
    logger.debug(`[nsfw-monitor] 🤖 callVisionLLM: Connecting to ${url}`);

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
            logger.warn(`[nsfw-monitor] ⏰ LLM request timeout (60s)`);
            controller.abort();
        }, 60000);

        logger.debug(`[nsfw-monitor] 🤖 Sending request to LLM API...`);
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
        logger.debug(`[nsfw-monitor] 🤖 LLM response received in ${responseTime}ms, status: ${response.status}`);

        if (!response.ok) {
            logger.error(`[nsfw-monitor] ❌ LLM API error: status ${response.status}`);
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;
        logger.debug(`[nsfw-monitor] 🤖 LLM raw response: ${content}`);

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        let result;
        if (jsonMatch) {
            result = JSON.parse(jsonMatch[0]);
        } else {
            result = JSON.parse(content);
        }

        // Normalize category to known values
        if (!NSFW_CATEGORIES[result.category]) {
            logger.warn(`[nsfw-monitor] Unknown category "${result.category}", defaulting to safe`);
            result.category = 'safe';
        }

        logger.debug(`[nsfw-monitor] 🤖 LLM parsed result: ${JSON.stringify(result)}`);
        return result;

    } catch (e) {
        if (e.name === 'AbortError') {
            logger.error(`[nsfw-monitor] ❌ LLM request aborted (timeout)`);
        } else {
            logger.error(`[nsfw-monitor] ❌ LLM error: ${e.message}`);
        }
        logger.debug(`[nsfw-monitor] 🤖 Returning safe default due to error`);
        return { category: "safe", confidence: 1, reason: "LLM error - defaulting to safe" };
    }
}

/**
 * Batch version: Analyze multiple images in a single LLM call
 * @param {string[]} base64Images - Array of base64 encoded images
 * @param {object} config - Guild config
 * @param {string|null} caption - Optional caption
 * @param {number[]} timestamps - Timestamps for each frame (for logging)
 * @returns {Promise<{isNsfw: boolean, reason: string}>}
 */
async function callVisionLLMBatch(base64Images, config, caption = null, timestamps = []) {
    const url = process.env.LM_STUDIO_URL || 'http://localhost:1234';
    logger.debug(`[nsfw-monitor] 🤖 callVisionLLMBatch: Analyzing ${base64Images.length} images`);

    // Get blocked categories for this guild
    let blockedCategories = config.nsfw_blocked_categories;
    if (!blockedCategories || !Array.isArray(blockedCategories)) {
        try {
            blockedCategories = typeof blockedCategories === 'string'
                ? JSON.parse(blockedCategories)
                : getDefaultBlockedCategories();
        } catch (e) {
            blockedCategories = getDefaultBlockedCategories();
        }
    }
    if (!blockedCategories.includes('minors')) {
        blockedCategories.push('minors');
    }

    const categoryList = Object.entries(NSFW_CATEGORIES)
        .map(([key, val]) => `- "${key}": ${val.description}`)
        .join('\n');

    const systemPrompt = `You are an image content classifier. Analyze these ${base64Images.length} video frames and classify each into ONE of these categories.

CATEGORIES:
${categoryList}

IMPORTANT RULES:
- "minors" takes absolute priority - if ANY sexualized content involves minors, classify as "minors"
- Distinguish between real photography and anime/cartoon/3D rendered content
- Analyze EACH frame independently but report if ANY frame is problematic

Respond ONLY with a JSON object:
{"frames": [{"category": "...", "confidence": 0.0-1.0}], "worst_category": "...", "worst_confidence": 0.0-1.0, "reason": "brief explanation of worst finding"}`;

    // Build user message with optional caption context
    let userMessage = `Analyze these ${base64Images.length} video frames for NSFW content.`;
    if (caption && caption.trim()) {
        userMessage += ` The uploader's caption was: "${caption.substring(0, 200)}"`;
    }

    // Build content array with multiple images
    const contentItems = [{ type: "text", text: userMessage }];
    for (let i = 0; i < base64Images.length; i++) {
        contentItems.push({
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${base64Images[i]}` }
        });
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            logger.warn(`[nsfw-monitor] ⏰ Batch LLM request timeout (90s)`);
            controller.abort();
        }, 90000); // Longer timeout for batch

        logger.debug(`[nsfw-monitor] 🤖 Sending batch request to LLM API...`);
        const requestStart = Date.now();

        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: process.env.LM_STUDIO_NSFW_MODEL || undefined,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: contentItems }
                ],
                temperature: 0.1,
                max_tokens: 300
            }),
            signal: controller.signal
        });
        clearTimeout(timeout);

        const responseTime = Date.now() - requestStart;
        logger.debug(`[nsfw-monitor] 🤖 Batch LLM response in ${responseTime}ms, status: ${response.status}`);

        if (!response.ok) {
            logger.error(`[nsfw-monitor] ❌ Batch LLM API error: status ${response.status}`);
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;
        logger.debug(`[nsfw-monitor] 🤖 Batch LLM raw response: ${content.substring(0, 200)}...`);

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        let result;
        if (jsonMatch) {
            result = JSON.parse(jsonMatch[0]);
        } else {
            result = JSON.parse(content);
        }

        // Check if worst category is blocked
        const worstCategory = result.worst_category || 'safe';
        const worstConfidence = result.worst_confidence || 0;
        const threshold = config.nsfw_threshold || 0.7;

        if (blockedCategories.includes(worstCategory) && worstConfidence >= threshold) {
            const categoryInfo = NSFW_CATEGORIES[worstCategory] || { name: worstCategory };
            return {
                isNsfw: true,
                reason: `${categoryInfo.name} (${Math.round(worstConfidence * 100)}%) - ${result.reason || 'Detected in video frames'}`
            };
        }

        return { isNsfw: false, reason: null };

    } catch (e) {
        if (e.name === 'AbortError') {
            logger.error(`[nsfw-monitor] ❌ Batch LLM request aborted (timeout)`);
        } else {
            logger.error(`[nsfw-monitor] ❌ Batch LLM error: ${e.message}`);
        }
        logger.debug(`[nsfw-monitor] 🤖 Returning safe default due to batch error`);
        return { isNsfw: false, reason: null };
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

/**
 * Analyze media WITHOUT executing any action (for Smart Report System)
 * @param {object} ctx - Telegram context with message containing media
 * @param {object} config - Guild config
 * @returns {Promise<{isNsfw: boolean, category: string, reason: string}>}
 */
async function analyzeMediaOnly(ctx, config) {
    const message = ctx.message;
    if (!message) return { isNsfw: false };

    // Determine media type
    let fileId;
    let type = 'photo';

    if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
    } else if (message.video) {
        fileId = message.video.file_id;
        type = 'video';
    } else if (message.animation) {
        fileId = message.animation.file_id;
        type = 'gif';
    } else if (message.sticker) {
        fileId = message.sticker.file_id;
        type = message.sticker.is_video ? 'gif' : 'photo';
    } else if (message.document) {
        if (message.document.mime_type?.startsWith('video')) {
            fileId = message.document.file_id;
            type = 'video';
        } else if (message.document.mime_type?.startsWith('image')) {
            fileId = message.document.file_id;
            type = 'photo';
        } else {
            return { isNsfw: false };
        }
    } else {
        return { isNsfw: false };
    }

    // Download and analyze
    let file;
    try {
        file = await ctx.api.getFile(fileId);
    } catch (e) {
        logger.error(`[nsfw-monitor] analyzeMediaOnly: getFile error - ${e.message}`);
        return { isNsfw: false };
    }

    const IS_LOCAL_API = !!process.env.TELEGRAM_API_URL;
    let downloadUrl;
    if (IS_LOCAL_API) {
        downloadUrl = `${process.env.TELEGRAM_API_URL}/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    } else {
        downloadUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    }

    const localPath = path.join(TEMP_DIR, `smartreport_${Date.now()}_${path.basename(file.file_path)}`);

    try {
        // Check for direct local path (Local API)
        let directLocalPath = null;
        if (IS_LOCAL_API && file.file_path.startsWith('/var/lib/telegram-bot-api/')) {
            const relativePath = file.file_path.replace('/var/lib/telegram-bot-api/', '');
            const mappedPath = path.join('./telegram-bot-api-data', relativePath);
            if (fs.existsSync(mappedPath)) {
                directLocalPath = mappedPath;
            }
        }

        if (directLocalPath) {
            fs.copyFileSync(directLocalPath, localPath);
        } else {
            await downloadFile(downloadUrl, localPath);
        }

        const caption = message.caption || null;
        const reasons = [];

        let isNsfw = false;
        if (type === 'video' || type === 'gif') {
            isNsfw = await checkVideo(localPath, config, reasons, caption);
        } else {
            isNsfw = await checkImage(localPath, config, reasons, caption);
        }

        return {
            isNsfw: isNsfw,
            category: isNsfw ? (reasons[0]?.split(' ')[0] || 'nsfw') : 'safe',
            reason: reasons[0] || null
        };
    } catch (e) {
        logger.error(`[nsfw-monitor] analyzeMediaOnly error: ${e.message}`);
        return { isNsfw: false };
    } finally {
        try { fs.unlinkSync(localPath); } catch (e) { }
    }
}

module.exports = {
    processMedia,
    analyzeMediaOnly,
    testConnection,
    NSFW_CATEGORIES,
    getDefaultBlockedCategories
};
