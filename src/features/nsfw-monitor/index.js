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

function register(bot, database) {
    db = database;
    
    // Handler: photos and videos
    bot.on(["message:photo", "message:video", "message:animation"], async (ctx, next) => {
        if (ctx.chat.type === 'private' || ctx.userTier >= 3) return next();
        // TODO: Implement Vision LLM NSFW detection
        await next();
    });
    
    // Command: /nsfwconfig
    bot.command("nsfwconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        await ctx.reply("🔞 NSFW config (TODO)");
    });
}

module.exports = { register };
