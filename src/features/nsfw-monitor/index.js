// ============================================================================
// TODO: IMPLEMENTATION PLAN - NSFW MONITOR
// ============================================================================
// SCOPO: Rilevamento contenuti NSFW (immagini/video/GIF) tramite Vision LLM.
// Usa modello Vision via LM Studio (es: LLaVA, MiniCPM-V).
// Per video: estrae frame ogni 5% della durata (proporzionale).
// Azioni semplificate: solo DELETE o BAN (con forward a SuperAdmin).
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: guild_config (campi nsfw)
// ├── nsfw_enabled: INTEGER (0/1, DEFAULT 1)
// ├── nsfw_action: TEXT (DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── nsfw_threshold: REAL (DEFAULT 0.7)
// ├── nsfw_check_photos: INTEGER (0/1, DEFAULT 1)
// ├── nsfw_check_videos: INTEGER (0/1, DEFAULT 1)
// ├── nsfw_check_gifs: INTEGER (0/1, DEFAULT 1)
// ├── nsfw_check_stickers: INTEGER (0/1, DEFAULT 0)
// ├── nsfw_frame_interval_percent: INTEGER (DEFAULT 5)
// │   └── Estrai 1 frame ogni N% del video
// └── nsfw_tier_bypass: INTEGER (DEFAULT 3)

// ----------------------------------------------------------------------------
// 2. INFRASTRUCTURE - Vision LLM via LM Studio
// ----------------------------------------------------------------------------
//
// PROVIDER: LM Studio (localhost)
// ENDPOINT: process.env.LM_STUDIO_URL || 'http://localhost:1234'
// PATH: /v1/chat/completions
// TIMEOUT: 8000ms per frame
//
// MODELLI VISION CONSIGLIATI (piccoli, ~4B):
// ├── MiniCPM-V-2.6 (4B) - Eccellente per classificazione
// ├── LLaVA-v1.6-Mistral-7B - Buon bilanciamento
// ├── moondream2 (1.8B) - Ultraleggero
// └── Qwen2-VL-2B-Instruct - Molto veloce
//
// DIPENDENZA VIDEO: ffmpeg (deve essere installato)

// ----------------------------------------------------------------------------
// 3. VIDEO HANDLING - Estrazione Frame Proporzionale
// ----------------------------------------------------------------------------
//
// FORMATI SUPPORTATI:
// ├── .mp4 (video/mp4)
// ├── .webm (video/webm)
// ├── .webp animato (image/webp con animazione)
// ├── .gif (animation in Telegram)
// └── video_note (cerchietti)
//
// STRATEGIA: Frame ogni 5% della durata (proporzionale)
//
// FORMULA:
// frame_count = Math.floor(100 / nsfw_frame_interval_percent)
// timestamps = [5%, 10%, 15%, 20%, ..., 95%]
//
// (Salta 0% e 100% per evitare frame nero/credits)
//
// ESEMPI CON interval = 5%:
// ├── Video 1 minuto (60s) → 19 frame (ogni 3 secondi)
// ├── Video 5 minuti (300s) → 19 frame (ogni 15 secondi)
// ├── Video 10 minuti (600s) → 19 frame (ogni 30 secondi)
// ├── Video 1 ora (3600s) → 19 frame (ogni 3 minuti)
// └── Sempre 19 frame indipendentemente dalla durata!
//
// PSEUDOCODICE:
// function getFrameTimestamps(durationSeconds, intervalPercent = 5) {
//   const timestamps = [];
//   for (let pct = intervalPercent; pct < 100; pct += intervalPercent) {
//     timestamps.push((pct / 100) * durationSeconds);
//   }
//   return timestamps; // es: [3, 6, 9, 12, ...] per video 60s
// }
//
// ESTRAZIONE CON FFMPEG:
// Per ogni timestamp T:
// ffmpeg -ss T -i input.mp4 -vframes 1 -q:v 2 frame_T.jpg
//
// NOTA: -ss PRIMA di -i è più veloce (seek approssimativo)

// ----------------------------------------------------------------------------
// 4. WEBP ANIMATO - Caso Speciale
// ----------------------------------------------------------------------------
//
// .webp può essere statico o animato
// Per webp animati: estrarre frame come per video
//
// DETECTION animazione:
// └── Usare 'sharp' per verificare se ha più pagine/frame

// ----------------------------------------------------------------------------
// 5. SYSTEM PROMPT - Classificazione NSFW
// ----------------------------------------------------------------------------
//
// PROMPT:
// """
// You are an image content classifier for a Telegram group moderation bot.
// 
// Analyze this image and respond ONLY with a JSON object:
// {"nsfw": true/false, "category": "...", "confidence": 0.0-1.0, "reason": "..."}
//
// Categories:
// - "safe": Normal, appropriate content
// - "suggestive": Revealing clothing, provocative poses (borderline)
// - "nsfw_partial": Partial nudity, underwear visible
// - "nsfw_explicit": Full nudity, sexual content
// - "gore": Violence, blood, disturbing imagery
//
// Rules:
// - Be conservative: if unsure, mark as "safe"
// - Artwork/memes: generally "safe" unless explicitly sexual
// - Swimwear in normal context: "safe"
// - Focus on the PRIMARY content of the image
//
// Respond with JSON only, no explanation.
// """

// ----------------------------------------------------------------------------
// 6. WORKFLOW COMPLETO
// ----------------------------------------------------------------------------
//
// TRIGGER: Messaggio con photo, video, animation, document (webp/gif)
//
// STEP 1 - DETECT MEDIA TYPE:
// ├── message.photo → Immagine statica
// ├── message.video → Video MP4/WebM
// ├── message.animation → GIF animato
// ├── message.video_note → Cerchietto video
// └── message.document (webp) → Check se animato
//
// STEP 2 - TIER CHECK:
// └── IF user.tier >= nsfw_tier_bypass: SKIP
//
// STEP 3 - SIZE CHECK:
// └── IF file.size > 50MB: SKIP (troppo grande)
//
// STEP 4 - DOWNLOAD:
// ├── ctx.telegram.getFile(file_id)
// └── Download to /tmp/nsfw_check_UUID.ext
//
// STEP 5 - GET DURATION (per video):
// ├── ffprobe -v quiet -print_format json -show_format input.mp4
// └── duration = parseFloat(json.format.duration)
//
// STEP 6 - CALCULATE TIMESTAMPS:
// └── timestamps = getFrameTimestamps(duration, 5)
//
// STEP 7 - EXTRACT FRAMES:
// FOR EACH timestamp:
//   └── ffmpeg -ss {timestamp} -i input -vframes 1 frame_{i}.jpg
//
// STEP 8 - ANALYZE EACH FRAME:
// FOR EACH frame:
//   ├── Convert to base64
//   ├── Call Vision LLM
//   ├── Parse response
//   └── IF nsfw === true && confidence >= threshold:
//       └── STOP EARLY, VIOLATION FOUND (no need to check remaining)
//
// STEP 9 - DECISION:
// ├── Se almeno 1 frame NSFW → esegui nsfw_action
// └── Se tutti safe → PASS
//
// STEP 10 - CLEANUP:
// └── Elimina tutti i file temporanei

// ----------------------------------------------------------------------------
// 7. ACTION HANDLER - Solo Delete/Ban/Report
// ----------------------------------------------------------------------------
//
// action === 'delete':
// └── ctx.deleteMessage() silenzioso
//
// action === 'ban':
// ├── ctx.deleteMessage()
// ├── ctx.banChatMember(userId)
// ├── **FORWARD A SUPERADMIN**:
// │   ┌────────────────────────────────────────────┐
// │   │ 🔨 **BAN ESEGUITO (NSFW Vision)**          │
// │   │                                            │
// │   │ 🏛️ Gruppo: Nome Gruppo                    │
// │   │ 👤 Utente: @username (ID: 123456)         │
// │   │ 📹 Media: VIDEO (19 frame analizzati)     │
// │   │ 🤖 AI: nsfw_explicit (92%) @ frame 7      │
// │   │ ⏱️ Timestamp violazione: 01:45            │
// │   │ 📝 Reason: "explicit content detected"    │
// │   └────────────────────────────────────────────┘
// │   [ 🌍 Global Ban ] [ ✅ Solo Locale ]
// └── Auto-delete forward dopo 24h
//
// action === 'report_only':
// └── Staff locale decide

// ----------------------------------------------------------------------------
// 8. CONFIGURATION UI - /nsfwconfig
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ 🔞 **NSFW VISION MONITOR**                 │
// │                                            │
// │ Stato: ✅ Attivo                           │
// │ Server: localhost:1234 (🟢)               │
// │ ffmpeg: ✅                                 │
// │ Analisi oggi: 234 img, 45 video           │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ 🔞 Monitor: ON ] [ 🔗 Test ]
// [ 👮 Azione: Delete ▼ ]
// [ 📊 Soglia: 70% ◀▶ ]
// [ 🖼️ Foto: ✅ ] [ 📹 Video: ✅ ] [ 🎬 GIF: ✅ ]
// [ 🎞️ Intervallo frame: 5% ◀▶ ]
// [ 💾 Salva ] [ ❌ Chiudi ]

// ----------------------------------------------------------------------------
// 9. DEPENDENCIES
// ----------------------------------------------------------------------------
//
// NPM:
// ├── fluent-ffmpeg
// ├── @ffmpeg-installer/ffmpeg
// └── sharp
//
// INSTALL:
// npm install fluent-ffmpeg @ffmpeg-installer/ffmpeg sharp

// ----------------------------------------------------------------------------
// 10. LIMITS
// ----------------------------------------------------------------------------
//
// ├── Max file size: 50MB
// ├── Max video duration: ILLIMITATA
// ├── Frame interval: 5% (= 19 frame per video)
// ├── Timeout per frame: 8 secondi
// ├── Max concurrent: 2 video alla volta
// └── Early stop: appena trova NSFW, non analizza altri frame

// ============================================================================
// MODULE EXPORTS
// ============================================================================

let db = null;

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

        await sendConfigUI(ctx, true);
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

async function sendConfigUI(ctx, isEdit = false) {
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

    const keyboard = {
        inline_keyboard: [
            [{ text: `🔞 Monitor: ${enabled}`, callback_data: "nsf_toggle" }, { text: "🔗 Test Conn", callback_data: "nsf_test" }],
            [{ text: `👮 Azione: ${action}`, callback_data: "nsf_act" }, { text: `📊 Soglia: ${thr}%`, callback_data: "nsf_thr" }],
            [{ text: `📷 ${p}`, callback_data: "nsf_tog_photo" }, { text: `📹 ${v}`, callback_data: "nsf_tog_video" }, { text: `🎞️ ${g}`, callback_data: "nsf_tog_gif" }],
            [{ text: "❌ Chiudi", callback_data: "nsf_close" }]
        ]
    };

    if (isEdit) {
        try { await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'Markdown' }); } catch (e) { }
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = { register };
