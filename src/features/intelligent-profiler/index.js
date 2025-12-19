// ============================================================================
// TODO: IMPLEMENTATION PLAN - INTELLIGENT PROFILER
// ============================================================================
// SCOPO: Profilazione nuovi utenti (Tier 0) per rilevare comportamenti
// sospetti. Analizza link, forward, pattern scam nei primi messaggi.
// Azioni semplificate: solo DELETE o BAN (con forward a SuperAdmin).
// ============================================================================

// ----------------------------------------------------------------------------
// 1. TIER SYSTEM - Reference
// ----------------------------------------------------------------------------
//
// TIER 0 - "Novizio" (local_flux < 100):
// └── Massimo scrutinio: tutti i controlli attivi
//
// TIER 1+ → Bypass profiler (già verificati)

// ----------------------------------------------------------------------------
// 2. CONTENT CHECKS - Analisi Messaggi Tier 0
// ----------------------------------------------------------------------------
//
// CHECK A - LINK DETECTION:
// ├── Estrai tutti i link dal messaggio
// ├── Verifica contro whitelist (telegram.org, etc.)
// ├── Verifica contro blacklist (IntelNetwork)
// └── Link sconosciuto da Tier 0 → report o delete
//
// CHECK B - FORWARD DETECTION:
// ├── Messaggio è forward da canale?
// ├── Canale è in blacklist?
// └── Forward + link da Tier 0 → molto sospetto
//
// CHECK C - SCAM PATTERN DETECTION:
// ├── Keywords: "guadagna", "gratis", "crypto", "airdrop"
// ├── Urgenza: "ora", "subito", "ultimo giorno"
// ├── Pattern noti: wallet address, telegram invite

// ----------------------------------------------------------------------------
// 3. ACTION HANDLER - Solo Delete/Ban/Report
// ----------------------------------------------------------------------------
//
// TABELLA: guild_config (campi profiler)
// ├── profiler_enabled: INTEGER (0/1, DEFAULT 1)
// ├── profiler_action_link: TEXT (DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── profiler_action_forward: TEXT (DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// └── profiler_action_pattern: TEXT (DEFAULT 'report_only')
//     └── Valori SOLO: 'delete', 'ban', 'report_only'
//
// action === 'delete':
// └── ctx.deleteMessage() silenzioso
//
// action === 'ban':
// ├── ctx.deleteMessage()
// ├── ctx.banChatMember(userId)
// ├── **FORWARD A SUPERADMIN**:
// │   ┌────────────────────────────────────────────┐
// │   │ 🔨 **BAN ESEGUITO (Profiler)**             │
// │   │ 🏛️ Gruppo: Nome                           │
// │   │ 👤 Utente: @username (TIER 0 - Nuovo)     │
// │   │ ⚠️ Trigger: Link sconosciuto              │
// │   │ 💬 "Clicca qui: sketchy-site.com"         │
// │   └────────────────────────────────────────────┘
// │   [ ➕ Blacklist Link ] [ 🌍 Global Ban ]
// └── Auto-delete forward dopo 24h
//
// action === 'report_only':
// └── Invia a staff locale per review

// ----------------------------------------------------------------------------
// 4. CONFIGURATION UI - /profilerconfig
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ 🔍 **PROFILER NUOVI UTENTI**               │
// │ Stato: ✅ | Sospetti oggi: 12              │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ 🔍 Profiler: ON ]
// [ 🔗 Link: Delete ▼ ] → [ Delete | Ban | Report ]
// [ 📤 Forward: Delete ▼ ] → [ Delete | Ban | Report ]
// [ 📝 Pattern: Report ▼ ] → [ Delete | Ban | Report ]
// [ 💾 Salva ] [ ❌ Chiudi ]

// ============================================================================
// MODULE EXPORTS
// ============================================================================

let db = null;

const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');

let _botInstance = null;

// Heuristic scam patterns
const SCAM_PATTERNS = [
    /guadagna/i, /gratis/i, /crypto/i, /airdrop/i, /investi/i,
    /bitcoin/i, /usdt/i, /wallet/i, /passiva/i, /rendita/i,
    /click here/i, /limited time/i, /free money/i, /giveaway/i
];

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Middleware: profile Tier 0 users
    bot.on("message", async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip check for admins
        const member = await ctx.getChatMember(ctx.from.id);
        if (['creator', 'administrator'].includes(member.status)) return next();

        // Config check
        const config = db.getGuildConfig(ctx.chat.id);
        if (!config.profiler_enabled) return next();

        // Require Tier 0 (Novice)
        if (ctx.userTier === undefined || ctx.userTier >= 1) return next();

        await processNewUser(ctx, config);
        await next();
    });

    // Command: /profilerconfig
    bot.command("profilerconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        const member = await ctx.getChatMember(ctx.from.id);
        if (!['creator', 'administrator'].includes(member.status)) return;

        await sendConfigUI(ctx);
    });

    // UI Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("prf_")) return next();

        const config = db.getGuildConfig(ctx.chat.id);
        // Check if we came from settings menu
        let fromSettings = false;
        try {
            const markup = ctx.callbackQuery.message.reply_markup;
            if (markup && markup.inline_keyboard) {
                fromSettings = markup.inline_keyboard.some(row => row.some(btn => btn.callback_data === 'settings_main'));
            }
        } catch (e) { }

        if (data === "prf_close") return ctx.deleteMessage();

        if (data === "prf_toggle") {
            db.updateGuildConfig(ctx.chat.id, { profiler_enabled: config.profiler_enabled ? 0 : 1 });
        } else if (data === "prf_act_link") {
            const acts = ['delete', 'ban', 'report_only'];
            let cur = config.profiler_action_link || 'delete';
            if (!acts.includes(cur)) cur = 'delete';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 3];
            db.updateGuildConfig(ctx.chat.id, { profiler_action_link: nextAct });
        } else if (data === "prf_act_fwd") {
            const acts = ['delete', 'ban', 'report_only'];
            let cur = config.profiler_action_forward || 'delete';
            if (!acts.includes(cur)) cur = 'delete';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 3];
            db.updateGuildConfig(ctx.chat.id, { profiler_action_forward: nextAct });
        } else if (data === "prf_act_pat") {
            const acts = ['delete', 'ban', 'report_only'];
            let cur = config.profiler_action_pattern || 'report_only';
            if (!acts.includes(cur)) cur = 'report_only';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 3];
            db.updateGuildConfig(ctx.chat.id, { profiler_action_pattern: nextAct });
        }

        await sendConfigUI(ctx, true, fromSettings);
    });
}

async function processNewUser(ctx, config) {
    const text = ctx.message.text || ctx.message.caption || "";

    // 1. Link Check
    const links = extractLinks(text);
    if (links.length > 0) {
        // Unknown links from Tier 0 are suspicious
        // Logic: if not whitelisted locally or globally -> SUSPICIOUS
        // We rely on link-monitor for detailed checks, but here we can be stricter for Tier 0.
        // Let's assume ANY link from Tier 0 is suspect if configured action is strict.
        // Or check standard whitelist (google, telegram, etc.)
        const whitelist = ['telegram.org', 't.me', 'youtube.com', 'google.com']; // Hardcoded base
        const isSafe = links.every(l => {
            try { return whitelist.some(w => new URL(l).hostname.endsWith(w)); } catch (e) { return false; }
        });

        if (!isSafe) {
            await executeAction(ctx, config.profiler_action_link || 'delete', 'Tier 0 Link', text);
            return; // Stop
        }
    }

    // 2. Forward Check
    if (ctx.message.forward_from || ctx.message.forward_from_chat) {
        await executeAction(ctx, config.profiler_action_forward || 'delete', 'Tier 0 Forward', "[Forwarded Message]");
        return; // Stop
    }

    // 3. Pattern Check
    let patternScore = 0;
    for (const p of SCAM_PATTERNS) {
        if (p.test(text)) patternScore++;
    }

    if (patternScore >= 2) {
        await executeAction(ctx, config.profiler_action_pattern || 'report_only', `Scam Pattern (Score ${patternScore})`, text);
        return;
    }
}

function extractLinks(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.match(urlRegex) || [];
}

async function executeAction(ctx, action, reason, content) {
    const user = ctx.from;
    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'profiler_detect',
        targetUser: user,
        executorAdmin: null,
        reason: `Profiler: ${reason}`,
        isGlobal: (action === 'ban')
    };

    if (action === 'delete') {
        try { await ctx.deleteMessage(); } catch (e) { }
    }
    else if (action === 'ban') {
        try {
            await ctx.deleteMessage();
            await ctx.banChatMember(user.id);
            userReputation.modifyFlux(user.id, ctx.chat.id, -50, 'profiler_ban');

            if (superAdmin.forwardBanToParliament) {
                superAdmin.forwardBanToParliament({
                    user: user,
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: `Profiler Ban: ${reason}`,
                    evidence: content,
                    flux: userReputation.getLocalFlux(user.id, ctx.chat.id)
                });
            }

            logParams.eventType = 'ban';
            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);

        } catch (e) { console.error(e); }
    }
    else if (action === 'report_only') {
        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Profiler',
            user: user,
            reason: `${reason}`,
            messageId: ctx.message.message_id,
            content: content
        });
    }
}

async function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.profiler_enabled ? '✅ ON' : '❌ OFF';
    const actLink = (config.profiler_action_link || 'delete').toUpperCase().replace(/_/g, ' ');
    const actFwd = (config.profiler_action_forward || 'delete').toUpperCase().replace(/_/g, ' ');
    const actPat = (config.profiler_action_pattern || 'report_only').toUpperCase().replace(/_/g, ' ');

    const text = `🔍 **PROFILER NUOVI UTENTI**\n\n` +
        `Analizza i nuovi arrivati per bloccare bot e spammer istantanei.\n` +
        `Smette di controllare gli utenti appena diventano fidati.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Controlla se inviano subito Link o Inoltrati\n` +
        `• Rileva frasi tipiche da bot ("guadagna subito", ecc)\n` +
        `• Protegge dalle ondate di account falsi\n\n` +
        `Stato: ${enabled}\n` +
        `Azione Link: ${actLink}\n` +
        `Azione Fwd: ${actFwd}\n` +
        `Azione Pattern: ${actPat}`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "prf_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `🔍 Profiler: ${enabled}`, callback_data: "prf_toggle" }],
            [{ text: `🔗 Link: ${actLink}`, callback_data: "prf_act_link" }],
            [{ text: `📤 Forward: ${actFwd}`, callback_data: "prf_act_fwd" }],
            [{ text: `📝 Pattern: ${actPat}`, callback_data: "prf_act_pat" }],
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
