const fs = require('fs');
const path = require('path');
const https = require('https');
const imghash = require('imghash');
const { handleCriticalError } = require('../../utils/error-handlers');
const actions = require('./actions');

const TEMP_DIR = path.join(__dirname, '../../temp_visual');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

async function processVisual(ctx, db, config) {
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
        const match = findMatch(db, hash, ctx.chat.id, config.visual_hamming_threshold || 5);
        if (match && match.type === 'ban') {
            await actions.executeAction(ctx, db, config.visual_action || 'delete', match, hash);
        }
    } catch (e) {
        handleCriticalError('visual-immune', 'processVisual', e, ctx);
    } finally {
        try { fs.unlinkSync(localPath); } catch (e) { /* cleanup - ignore */ }
    }
}

async function addToDb(ctx, db, msg, type, category) {
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

function findMatch(db, targetHash, guildId, threshold) {
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

module.exports = {
    processVisual,
    addToDb,
    findMatch,
    hammingDistance
};
