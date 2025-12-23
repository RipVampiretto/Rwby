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
const envConfig = require('../../config/env');

const TEMP_DIR = path.join(process.cwd(), 'temp', 'nsfw');
const LM_STUDIO_CONVERSATIONS_DIR = '/Users/ripvampiretto/.lmstudio/conversations/Rwby';

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Save conversation to LM Studio format
 * @param {string} chatId - Telegram chat ID
 * @param {string} systemPrompt - System prompt used
 * @param {string} userMessage - User message
 * @param {string} base64Image - Base64 encoded image
 * @param {string} responseText - LLM response text
 * @param {object} stats - Response statistics
 */
function saveLMStudioConversation(chatId, systemPrompt, userMessage, base64Image, responseText, stats) {
    try {
        const crypto = require('crypto');
        const chatDir = path.join(LM_STUDIO_CONVERSATIONS_DIR, String(chatId));
        const userFilesDir = '/Users/ripvampiretto/.lmstudio/user-files';

        // Create directories if they don't exist
        if (!fs.existsSync(chatDir)) {
            fs.mkdirSync(chatDir, { recursive: true });
        }
        if (!fs.existsSync(userFilesDir)) {
            fs.mkdirSync(userFilesDir, { recursive: true });
        }

        const timestamp = Date.now();
        const imageBuffer = Buffer.from(base64Image, 'base64');
        const imageSize = imageBuffer.length;
        const sha256Hex = crypto.createHash('sha256').update(imageBuffer).digest('hex');

        // Generate random number for file identifier (like LM Studio does)
        const randomNum = Math.floor(Math.random() * 100);
        const fileIdentifier = `${timestamp} - ${randomNum}.jpg`;

        // Save image to user-files directory
        const imagePath = path.join(userFilesDir, fileIdentifier);
        fs.writeFileSync(imagePath, imageBuffer);

        // Create metadata file
        const metadataPath = path.join(userFilesDir, `${fileIdentifier}.metadata.json`);
        const metadata = {
            type: 'image',
            sizeBytes: imageSize,
            originalName: `nsfw_${chatId}_${timestamp}.jpg`,
            fileIdentifier: fileIdentifier,
            preview: {
                data: `data:image/jpeg;base64,${base64Image}`
            },
            sha256Hex: sha256Hex
        };
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

        logger.debug(`[nsfw-monitor] 🖼️ Saved image to user-files: ${imagePath}`);

        // Generate a name based on primary category if available
        let conversationName = 'NSFW Analysis';
        try {
            const parsed = JSON.parse(responseText.match(/\{[\s\S]*\}/)?.[0] || '{}');
            if (parsed.primary_category) {
                conversationName = `NSFW: ${parsed.primary_category}`;
            }
        } catch (e) { }

        const conversation = {
            name: conversationName,
            pinned: false,
            createdAt: timestamp,
            preset: '',
            tokenCount: stats.totalTokensCount || 0,
            userLastMessagedAt: timestamp,
            systemPrompt: '',
            messages: [
                {
                    versions: [
                        {
                            type: 'singleStep',
                            role: 'user',
                            content: [
                                {
                                    type: 'text',
                                    text: systemPrompt + '\n\n' + userMessage
                                },
                                {
                                    type: 'file',
                                    fileIdentifier: fileIdentifier,
                                    fileType: 'image',
                                    sizeBytes: imageSize
                                }
                            ]
                        }
                    ],
                    currentlySelected: 0
                },
                {
                    versions: [
                        {
                            type: 'multiStep',
                            role: 'assistant',
                            steps: [
                                {
                                    type: 'contentBlock',
                                    stepIdentifier: `${timestamp}-0.${Math.random().toString().slice(2, 18)}`,
                                    content: [
                                        {
                                            type: 'text',
                                            text: responseText,
                                            fromDraftModel: false,
                                            tokensCount: stats.predictedTokensCount || 0,
                                            isStructural: false
                                        }
                                    ],
                                    defaultShouldIncludeInContext: true,
                                    shouldIncludeInContext: true,
                                    genInfo: {
                                        indexedModelIdentifier: envConfig.LM_STUDIO.nsfwModel,
                                        identifier: envConfig.LM_STUDIO.nsfwModel,
                                        stats: {
                                            stopReason: 'eosFound',
                                            tokensPerSecond: stats.tokensPerSecond || 0,
                                            timeToFirstTokenSec: stats.timeToFirstTokenSec || 0,
                                            totalTimeSec: stats.totalTimeSec || 0,
                                            promptTokensCount: stats.promptTokensCount || 0,
                                            predictedTokensCount: stats.predictedTokensCount || 0,
                                            totalTokensCount: stats.totalTokensCount || 0
                                        }
                                    }
                                }
                            ],
                            senderInfo: {
                                senderName: envConfig.LM_STUDIO.nsfwModel
                            }
                        }
                    ],
                    currentlySelected: 0
                }
            ],
            usePerChatPredictionConfig: true,
            perChatPredictionConfig: { fields: [] },
            clientInput: '',
            clientInputFiles: [],
            userFilesSizeBytes: imageSize,
            lastUsedModel: {
                identifier: envConfig.LM_STUDIO.nsfwModel,
                indexedModelIdentifier: envConfig.LM_STUDIO.nsfwModel,
                instanceLoadTimeConfig: { fields: [] },
                instanceOperationTimeConfig: { fields: [] }
            },
            notes: [],
            plugins: [],
            pluginConfigs: {},
            disabledPluginTools: [],
            looseFiles: [],
            assistantLastMessagedAt: timestamp + 100
        };

        const jsonPath = path.join(chatDir, `${timestamp}.conversation.json`);
        fs.writeFileSync(jsonPath, JSON.stringify(conversation, null, 2));
        logger.debug(`[nsfw-monitor] 💾 Saved conversation to LM Studio: ${jsonPath}`);
    } catch (e) {
        logger.warn(`[nsfw-monitor] ⚠️ Failed to save LM Studio conversation: ${e.message}`);
    }
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
        logger.debug(
            `[nsfw-monitor] 📷 Photo detected - Size: ${fileSize} bytes, Dimensions: ${photo.width}x${photo.height}`
        );
    } else if (ctx.message.video) {
        fileId = ctx.message.video.file_id;
        type = 'video';
        fileSize = ctx.message.video.file_size || 0;
        logger.debug(
            `[nsfw-monitor] 🎥 Video detected - Size: ${fileSize} bytes, Duration: ${ctx.message.video.duration}s`
        );
    } else if (ctx.message.animation) {
        fileId = ctx.message.animation.file_id;
        type = 'gif';
        fileSize = ctx.message.animation.file_size || 0;
        logger.debug(`[nsfw-monitor] 🎞️ Animation/GIF detected - Size: ${fileSize} bytes`);
    } else if (ctx.message.document) {
        fileId = ctx.message.document.file_id;
        fileSize = ctx.message.document.file_size || 0;
        logger.debug(
            `[nsfw-monitor] 📄 Document detected - MIME: ${ctx.message.document.mime_type}, Size: ${fileSize} bytes`
        );
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
        logger.warn(
            `[nsfw-monitor] ⚠️ File too large (${(fileSize / 1024 / 1024).toFixed(2)} MB), limit is ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)} MB. Skipping analysis.`
        );
        return;
    }

    if (type === 'video' && ctx.message.video?.duration > MAX_VIDEO_DURATION) {
        logger.warn(
            `[nsfw-monitor] ⚠️ Video too long (${(ctx.message.video.duration / 60).toFixed(1)} min), skipping analysis`
        );
        return;
    }

    let file;
    try {
        file = await ctx.api.getFile(fileId);
    } catch (err) {
        // Handle "file is too big" error specifically
        if (err.description && err.description.includes('file is too big')) {
            logger.warn(
                `[nsfw-monitor] ⚠️ Telegram API Error: File is too big to download via Cloud API. Consider using Local API Server.`
            );
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
            logger.info(
                `[nsfw-monitor] ⬇️ Downloading file to: ${localPath} (Source: ${IS_LOCAL_API ? 'Local API' : 'Cloud API'})`
            );
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
        const reasons = [];

        // Extract caption if available (photos/videos can have captions)
        const caption = ctx.message.caption || null;
        if (caption) {
            logger.debug(`[nsfw-monitor] 📝 Caption present: "${caption.substring(0, 50)}..."`);
        }

        if (type === 'video' || type === 'gif') {
            logger.info(`[nsfw-monitor] 🎬 Starting VIDEO/GIF analysis...`);
            isNsfw = await checkVideo(localPath, config, reasons, caption, chatId);
        } else {
            logger.info(`[nsfw-monitor] 🖼️ Starting IMAGE analysis...`);
            isNsfw = await checkImage(localPath, config, reasons, caption, chatId);
        }

        const totalTime = Date.now() - startTime;
        if (isNsfw) {
            logger.warn(
                `[nsfw-monitor] 🚨 NSFW DETECTED - Chat: ${chatId}, User: ${userId}, Reason: ${reasons[0]}, TotalTime: ${totalTime}ms`
            );
            await actions.executeAction(ctx, config.nsfw_action || 'delete', reasons[0], type);
        } else {
            logger.info(
                `[nsfw-monitor] ✅ Content is SAFE - Chat: ${chatId}, User: ${userId}, TotalTime: ${totalTime}ms`
            );
        }
    } finally {
        // Cleanup main file
        logger.debug(`[nsfw-monitor] 🧹 Cleaning up temp file: ${localPath}`);
        try {
            fs.unlinkSync(localPath);
        } catch (e) { }
    }
}

async function downloadFile(url, dest) {
    logger.debug(`[nsfw-monitor] ⬇️ downloadFile: Starting download to ${dest}`);
    const client = url.startsWith('http:') ? http : https;

    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        client
            .get(url, response => {
                logger.debug(`[nsfw-monitor] ⬇️ downloadFile: Got response, status: ${response.statusCode}`);
                response.pipe(file);
                file.on('finish', () => {
                    logger.debug(`[nsfw-monitor] ⬇️ downloadFile: File write finished`);
                    file.close(resolve);
                });
            })
            .on('error', err => {
                logger.error(`[nsfw-monitor] ❌ downloadFile: Error - ${err.message}`);
                fs.unlink(dest, () => { });
                reject(err);
            });
    });
}

async function checkImage(imagePath, config, reasons, caption = null, chatId = null) {
    logger.debug(`[nsfw-monitor] 🖼️ checkImage: Reading file ${imagePath}`);
    const buffer = fs.readFileSync(imagePath);
    const base64 = buffer.toString('base64');
    const base64Size = Math.round(base64.length / 1024);
    logger.debug(`[nsfw-monitor] 🖼️ checkImage: Base64 size: ${base64Size}KB`);

    logger.info(`[nsfw-monitor] 🤖 Sending image to Vision LLM for analysis...`);
    const llmStart = Date.now();
    const res = await callVisionLLM(base64, caption, chatId);
    const llmTime = Date.now() - llmStart;

    logger.info(
        `[nsfw-monitor] 🤖 LLM Response (${llmTime}ms): primary=${res.primary_category}, uncertainty=${res.uncertainty}, reason=${res.reason || 'N/A'}`
    );

    // Get blocked categories for this guild
    let blockedCategories = config.nsfw_blocked_categories;
    if (!blockedCategories || !Array.isArray(blockedCategories)) {
        try {
            blockedCategories =
                typeof blockedCategories === 'string' ? JSON.parse(blockedCategories) : getDefaultBlockedCategories();
        } catch (e) {
            blockedCategories = getDefaultBlockedCategories();
        }
    }

    // Always block minors regardless of config
    if (!blockedCategories.includes('minors')) {
        blockedCategories.push('minors');
    }

    const threshold = config.nsfw_threshold || 0.7;
    const scores = res.scores || {};

    // Check minors FIRST with absolute priority (lower threshold)
    if (scores.minors && scores.minors >= 0.5) {
        const categoryInfo = NSFW_CATEGORIES.minors;
        logger.warn(`[nsfw-monitor] 🚨 MINORS DETECTED: score=${scores.minors} (>= 0.5)`);
        reasons.push(`${categoryInfo.name} (${Math.round(scores.minors * 100)}%)`);
        return true;
    }

    // Check all blocked categories
    for (const category of blockedCategories) {
        const score = scores[category] || 0;
        if (score >= threshold) {
            const categoryInfo = NSFW_CATEGORIES[category] || { name: category };
            logger.warn(`[nsfw-monitor] ⚠️ Blocked category detected: ${category} (${score} >= ${threshold})`);
            reasons.push(`${categoryInfo.name} (${Math.round(score * 100)}%)`);
            return true;
        }
    }

    logger.debug(
        `[nsfw-monitor] ✅ Image passed check - primary: ${res.primary_category}, uncertainty: ${res.uncertainty}`
    );
    return false;
}

async function checkVideo(videoPath, config, reasons, caption = null, chatId = null) {
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

    // Adjust if video is shorter than MIN_FRAMES seconds
    // Ensure at least 1 frame for sub-second videos (Math.floor would return 0)
    const actualFrames = Math.max(1, Math.min(targetFrames, Math.floor(duration) || 1));

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
    const validFrames = framePaths.filter((f, i) => extractResults[i].status === 'fulfilled' && fs.existsSync(f.path));

    logger.info(
        `[nsfw-monitor] ⚡ Extraction complete: ${validFrames.length}/${timestamps.length} frames in ${Date.now() - extractStart}ms`
    );

    if (validFrames.length === 0) {
        logger.warn(`[nsfw-monitor] ⚠️ No frames extracted successfully`);
        return false;
    }

    logger.info(`[nsfw-monitor] 🎬 Analyzing ${validFrames.length} frames individually (frame-by-frame)...`);

    try {
        // Analyze each frame individually (unified logic with images)
        for (let i = 0; i < validFrames.length; i++) {
            const frame = validFrames[i];
            logger.debug(`[nsfw-monitor] 🤖 Frame ${i + 1}/${validFrames.length} at ${frame.timestamp.toFixed(1)}s`);

            const frameReasons = [];
            const isNsfw = await checkImage(frame.path, config, frameReasons, caption, chatId);

            if (isNsfw) {
                reasons.push(`Frame @${frame.timestamp.toFixed(1)}s: ${frameReasons[0]}`);
                logger.warn(`[nsfw-monitor] 🚨 NSFW detected at frame ${i + 1} (${frame.timestamp.toFixed(1)}s): ${frameReasons[0]}`);
                return true;
            }
        }

        logger.info(`[nsfw-monitor] ✅ All ${validFrames.length} frames passed check`);
        return false;
    } finally {
        // Cleanup all frame files
        logger.debug(`[nsfw-monitor] 🧹 Cleaning up ${validFrames.length} frame files...`);
        for (const frame of validFrames) {
            try {
                fs.unlinkSync(frame.path);
            } catch (e) { }
        }
    }
}

function getVideoDuration(filePath) {
    return new Promise(resolve => {
        logger.debug(`[nsfw-monitor] 🎬 ffprobe: Getting duration for ${filePath}`);
        fluentFfmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                logger.error(`[nsfw-monitor] ❌ ffprobe error: ${err.message}`);
                resolve(0);
            } else {
                logger.debug(
                    `[nsfw-monitor] 🎬 ffprobe: Duration = ${metadata.format.duration}s, Format = ${metadata.format.format_name}`
                );
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
            .on('error', err => {
                logger.error(`[nsfw-monitor] ❌ ffmpeg error: ${err.message}`);
                reject(err);
            })
            .run();
    });
}

/**
 * All available media analysis categories with descriptions
 */
const NSFW_CATEGORIES = {
    safe: { name: 'Safe', description: 'Normal, appropriate content', blockable: false },
    suggestive: { name: 'Suggestive', description: 'Revealing clothing, provocative poses', blockable: true },
    figures_nsfw: {
        name: 'NSFW Figures',
        description: 'Action figures/statues with nudity or sexual themes',
        blockable: true
    },
    real_nudity: { name: 'Real Nudity', description: 'Photographic/realistic human nudity', blockable: true },
    real_sex: { name: 'Real Sex', description: 'Photographic/realistic sexual acts', blockable: true },
    hentai: { name: 'Hentai', description: 'Explicit anime/manga sexual content', blockable: true },
    real_gore: { name: 'Real Gore', description: 'Photographic blood, injuries, graphic violence', blockable: true },
    drawn_gore: {
        name: 'Drawn Gore',
        description: 'Stylized/anime blood, injuries, graphic violence',
        blockable: true
    },
    scam_visual: {
        name: 'Visual Scams',
        description: 'Screenshots of scams, phishing, crypto scams, fake giveaways',
        blockable: true
    },
    minors: {
        name: 'Minors (CSAM)',
        description: 'Any sexualized content involving minors',
        blockable: false,
        alwaysBlocked: true
    }
};

/**
 * Get default blocked categories
 */
function getDefaultBlockedCategories() {
    return ['real_nudity', 'real_sex', 'hentai', 'real_gore', 'drawn_gore', 'minors', 'scam_visual'];
}

async function callVisionLLM(base64Image, caption = null, chatId = null) {
    const url = envConfig.LM_STUDIO.url;
    logger.debug(`[nsfw-monitor] 🤖 callVisionLLM: Connecting to ${url}`);

    const systemPrompt = `You are a vision-based content moderation assistant.

Your role is to analyze images and report visual signals related to potentially sensitive content.
You do NOT make final moderation or policy decisions.

You must follow these principles at all times:

- Base your analysis ONLY on visible evidence in the image.
- Do NOT assume intent, age, identity, or context beyond what is visually clear.
- Treat all outputs as uncertainty-aware signals, not ground truth.
- Avoid overconfidence: ambiguity must be reflected in lower scores.
- Multiple categories may partially apply to the same image.
- Your output will be used by downstream logic; accuracy and caution are more important than decisiveness.

Important clarification about nudity:
- Lingerie, underwear, bikinis, or revealing clothing WITHOUT visible genitals or nipples
  should generally be considered "suggestive", NOT "real_nudity".
- "real_nudity" should be used only when explicit nudity is clearly visible.

You must strictly follow the output format requested by the user.
Do not include extra text, explanations, or formatting outside the JSON response.

--------------------------------------------------
CATEGORIES TO EVALUATE
--------------------------------------------------

Evaluate EACH of the following categories independently and assign a score between 0.0 and 1.0 indicating how strongly the image matches the category.
Scores are RELATIVE STRENGTH signals, NOT calibrated probabilities.

- safe:
  Normal, appropriate, non-sensitive content.

- suggestive:
  Revealing clothing, sexualized body emphasis, or provocative poses,
  without explicit nudity or sexual acts.

- figures_nsfw:
  Action figures, statues, mannequins, or collectibles with nudity or sexual themes.
  Includes realistic statues even if they resemble real humans.

- real_nudity:
  Photographic or highly realistic depiction of nude human bodies,
  without explicit sexual acts. Requires visible genitals or nipples.

- real_sex:
  Photographic or highly realistic depiction of explicit sexual acts
  involving real humans.

- hentai:
  Explicit sexual content in anime, manga, cartoon, or stylized illustrated form.

- real_gore:
  Photographic or highly realistic blood, injuries, exposed organs,
  or graphic real-world violence.

- drawn_gore:
  Stylized, illustrated, animated, or video game depictions of blood,
  injuries, or graphic violence.

- scam_visual:
  Screenshots of scams, phishing attempts, crypto scams, fake giveaways,
  fake investment opportunities, or fraudulent offers.
  Look for: promises of money, cryptocurrency logos with suspicious text,
  screenshots of fake conversations, "you won" messages.

- minors:
  ANY sexualized content involving minors or individuals that appear to be minors.
  This category has ABSOLUTE PRIORITY.

--------------------------------------------------
CRITICAL RULES
--------------------------------------------------

1. MINORS ABSOLUTE PRIORITY:
   - If there is ANY indication of sexualized content involving minors,
     assign a HIGH score to "minors", even if uncertain.
   - If age is ambiguous, be conservative and reflect uncertainty in the score.

2. REAL VS DRAWN:
   - Carefully distinguish real photography from anime, cartoons, illustrations,
     CGI, or 3D renders.
   - Do NOT assume realism unless visual evidence is strong.

3. DO NOT FORCE CLASSIFICATION:
   - If the image does not clearly fit a category, use a low score.
   - It is acceptable for multiple categories to have moderate scores.

4. SCORE DISCIPLINE:
   - Scores > 0.90 should be used ONLY when evidence is extremely clear.
   - Scores between 0.40–0.70 indicate ambiguity or partial match.
   - Scores < 0.20 indicate weak or negligible evidence.

5. SAFE CATEGORY:
   - "safe" should have a HIGH score only if no other category shows
     meaningful evidence.

6. NUDITY VS SUGGESTIVE:
   - Lingerie, underwear, bikinis = "suggestive" (NOT "real_nudity")
   - Visible genitals or nipples = "real_nudity"

Your goal is NOT to make a final policy decision, but to report visual signals in a structured way.`;

    // Build user message with detailed prompt
    const userPromptBase = `Analyze the provided image and evaluate the following content categories.

For EACH category, assign a score between 0.0 and 1.0 indicating how strongly the image matches that category.
Scores are RELATIVE STRENGTH signals, NOT calibrated probabilities.

--------------------------------------------------
CATEGORIES
--------------------------------------------------

- safe:
  Normal, appropriate, non-sensitive content.

- suggestive:
  Revealing clothing, sexualized body emphasis, or provocative posing,
  WITHOUT explicit nudity or sexual acts.

- figures_nsfw:
  Action figures, statues, mannequins, or collectibles with nudity or sexual themes,
  even if they resemble realistic humans.

- real_nudity:
  Photographic or highly realistic depiction of nude human bodies
  with visible genitals or nipples, but without sexual acts.

- real_sex:
  Photographic or highly realistic depiction of explicit sexual acts
  involving real humans.

- hentai:
  Explicit sexual content in anime, manga, cartoons, or illustrated styles.

- real_gore:
  Photographic or highly realistic blood, injuries, exposed organs,
  or graphic real-world violence.

- drawn_gore:
  Stylized, illustrated, animated, or video game depictions of blood,
  injuries, or graphic violence.

- scam_visual:
  Screenshots of scams, phishing, crypto scams, fake giveaways.

- minors:
  ANY sexualized content involving minors or individuals who appear to be minors.

--------------------------------------------------
CRITICAL RULES
--------------------------------------------------

1. ABSOLUTE PRIORITY — MINORS:
   - If there is ANY sexualized content involving minors,
     assign a high score to "minors", even if uncertain.
   - If age is ambiguous, be conservative and reflect uncertainty in the score.

2. REAL VS DRAWN:
   - Carefully distinguish real photography from anime, cartoons,
     illustrations, CGI, or 3D renders.
   - Do NOT assume realism unless visual evidence is strong.

3. DO NOT FORCE CLASSIFICATION:
   - If the image does not clearly fit a category, use a low score.
   - It is acceptable and expected for multiple categories to have non-zero scores.

4. SCORE DISCIPLINE:
   - Scores > 0.90 only when evidence is extremely clear.
   - Scores between 0.40–0.70 indicate ambiguity or partial match.
   - Scores < 0.20 indicate weak or negligible evidence.

5. SAFE CATEGORY:
   - "safe" should have a high score ONLY if no other category
     shows meaningful evidence.

--------------------------------------------------
OUTPUT FORMAT (STRICT)
--------------------------------------------------

Respond ONLY with a valid JSON object in the following exact structure:

{
  "scores": {
    "safe": 0.0,
    "suggestive": 0.0,
    "figures_nsfw": 0.0,
    "real_nudity": 0.0,
    "real_sex": 0.0,
    "hentai": 0.0,
    "real_gore": 0.0,
    "drawn_gore": 0.0,
    "scam_visual": 0.0,
    "minors": 0.0
  },
  "primary_category": "...",
  "uncertainty": "low | medium | high",
  "reason": "Brief explanation of the strongest visual signals and remaining ambiguities"
}

--------------------------------------------------
FINAL NOTES
--------------------------------------------------

- "primary_category" should normally be the category with the highest score.
- If "minors" has a significant score, it MUST be selected as "primary_category".
- Be conservative, consistent, and honest about uncertainty.`;

    let userMessage = userPromptBase;
    if (caption && caption.trim()) {
        userMessage = `${userPromptBase}\n\nThe uploader's caption was: "${caption.substring(0, 200)}"`;
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            logger.warn(`[nsfw-monitor] ⏰ LLM request timeout (${envConfig.AI_TIMEOUTS.vision}ms)`);
            controller.abort();
        }, envConfig.AI_TIMEOUTS.vision);

        logger.debug(`[nsfw-monitor] 🤖 Sending request to LLM API...`);
        const requestStart = Date.now();

        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: envConfig.LM_STUDIO.nsfwModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: userMessage },
                            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                        ]
                    }
                ],
                temperature: 0.1,
                max_tokens: 500
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

        // Validate result structure
        if (!result.scores || typeof result.scores !== 'object') {
            logger.warn(`[nsfw-monitor] Invalid response structure, creating safe default`);
            result = {
                scores: { safe: 1.0 },
                primary_category: 'safe',
                uncertainty: 'high',
                reason: 'Invalid LLM response structure'
            };
        }

        logger.debug(`[nsfw-monitor] 🤖 LLM parsed result: ${JSON.stringify(result)}`);

        // Save conversation to LM Studio format
        if (chatId) {
            saveLMStudioConversation(chatId, systemPrompt, userMessage, base64Image, content, {
                tokensPerSecond: 0,
                timeToFirstTokenSec: 0,
                totalTimeSec: responseTime / 1000,
                promptTokensCount: 0,
                predictedTokensCount: 0,
                totalTokensCount: 0
            });
        }

        return result;
    } catch (e) {
        if (e.name === 'AbortError') {
            logger.error(`[nsfw-monitor] ❌ LLM request aborted (timeout)`);
        } else {
            logger.error(`[nsfw-monitor] ❌ LLM error: ${e.message}`);
        }
        logger.debug(`[nsfw-monitor] 🤖 Returning safe default due to error`);
        return {
            scores: { safe: 1.0 },
            primary_category: 'safe',
            uncertainty: 'high',
            reason: 'LLM error - defaulting to safe'
        };
    }
}


async function testConnection(ctx) {
    try {
        const url = envConfig.LM_STUDIO.url;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), envConfig.AI_TIMEOUTS.healthCheck);
        await fetch(`${url}/v1/models`, { signal: controller.signal });
        clearTimeout(timeout);
        await ctx.reply('✅ Connessione LM Studio con successo!');
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
            category: isNsfw ? reasons[0]?.split(' ')[0] || 'nsfw' : 'safe',
            reason: reasons[0] || null
        };
    } catch (e) {
        logger.error(`[nsfw-monitor] analyzeMediaOnly error: ${e.message}`);
        return { isNsfw: false };
    } finally {
        try {
            fs.unlinkSync(localPath);
        } catch (e) { }
    }
}

module.exports = {
    processMedia,
    analyzeMediaOnly,
    testConnection,
    NSFW_CATEGORIES,
    getDefaultBlockedCategories
};
