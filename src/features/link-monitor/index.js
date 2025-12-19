// ============================================================================
// TODO: IMPLEMENTATION PLAN - LINK MONITOR
// ============================================================================
// SCOPO: Controllo link/URL nei messaggi con whitelist/blacklist domini.
// Integrato con IntelNetwork per blacklist globale.
// Azioni semplificate: solo DELETE o BAN (con forward a SuperAdmin).
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: link_rules (per-gruppo)
// ├── id: INTEGER PRIMARY KEY
// ├── guild_id: INTEGER (0 = globale)
// ├── pattern: TEXT (dominio o wildcard)
// ├── type: TEXT ('whitelist', 'blacklist')
// ├── action: TEXT (solo blacklist, DEFAULT 'delete')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── category: TEXT ('scam', 'nsfw', 'spam', 'phishing')
// └── created_at: TEXT
//
// TABELLA: guild_config (campi link)
// ├── link_enabled: INTEGER (0/1, DEFAULT 1)
// ├── link_action_unknown: TEXT (DEFAULT 'report_only')
// │   └── Valori SOLO: 'delete', 'ban', 'report_only'
// ├── link_sync_global: INTEGER (0/1, DEFAULT 1)
// └── link_tier_bypass: INTEGER (DEFAULT 1)

// ----------------------------------------------------------------------------
// 2. DETECTION LOGIC - Priorità
// ----------------------------------------------------------------------------
//
// 1. WHITELIST LOCALE → Pass
// 2. WHITELIST GLOBALE → Pass
// 3. BLACKLIST LOCALE → Azione definita
// 4. BLACKLIST GLOBALE → Azione definita
// 5. UNKNOWN → link_action_unknown

// ----------------------------------------------------------------------------
// 3. ACTION HANDLER - Solo Delete/Ban/Report
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
// │   │ 🔨 **BAN ESEGUITO (Link)**                 │
// │   │ 🏛️ Gruppo: Nome                           │
// │   │ 👤 Utente: @username                       │
// │   │ 🔗 Link: scam-site.com                    │
// │   │ 📁 Categoria: SCAM                        │
// │   │ 💬 "Clicca qui per guadagnare..."         │
// │   └────────────────────────────────────────────┘
// │   [ ➕ Blacklist Globale ] [ 🌍 Global Ban ]
// └── Auto-delete forward dopo 24h
//
// action === 'report_only':
// └── Staff locale decide:
//     [ 🔨 Ban ] [ 🗑️ Delete ]
//     [ ✅ Whitelist ] [ 🚫 Blacklist ]

// ----------------------------------------------------------------------------
// 4. CONFIGURATION UI - /linkconfig
// ----------------------------------------------------------------------------
//
// KEYBOARD:
// [ 🔗 Monitor: ON ] [ 🌐 Sync: ON ]
// [ ❓ Unknown: Report ▼ ] → [ Delete | Ban | Report ]
// [ ➕ Aggiungi ] [ 📜 Lista ]
// [ 💾 Salva ] [ ❌ Chiudi ]

// ============================================================================
// MODULE EXPORTS
// ============================================================================

let db = null;

const staffCoordination = require('../staff-coordination');
const adminLogger = require('../admin-logger');
const userReputation = require('../user-reputation');
const superAdmin = require('../super-admin');
const { safeDelete, safeEdit, safeBan, isAdmin, handleCriticalError, isFromSettingsMenu } = require('../../utils/error-handlers');
const logger = require('../../middlewares/logger');

let _botInstance = null;

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Middleware: link detection
    bot.on("message:text", async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Skip admins
        if (await isAdmin(ctx, 'link-monitor')) return next();

        // Config check
        const config = db.getGuildConfig(ctx.chat.id);
        if (!config.link_enabled) return next();

        // Tier check
        if (ctx.userTier !== undefined && ctx.userTier >= config.link_tier_bypass) return next();

        const links = extractLinks(ctx.message.text);
        if (links.length === 0) return next();

        await processLinks(ctx, config, links);
        await next();
    });

    // Command: /linkconfig
    bot.command("linkconfig", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        if (!await isAdmin(ctx, 'link-monitor')) return;

        await sendConfigUI(ctx);
    });

    // UI Handlers
    bot.on("callback_query:data", async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith("lnk_")) return next();

        const config = db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === "lnk_close") return ctx.deleteMessage();

        if (data === "lnk_toggle") {
            db.updateGuildConfig(ctx.chat.id, { link_enabled: config.link_enabled ? 0 : 1 });
        } else if (data === "lnk_sync") {
            db.updateGuildConfig(ctx.chat.id, { link_sync_global: config.link_sync_global ? 0 : 1 });
        } else if (data === "lnk_act_unk") {
            // cycle delete -> ban -> report_only
            const states = ['delete', 'ban', 'report_only'];
            let current = config.link_action_unknown || 'report_only';
            if (!states.includes(current)) current = 'report_only';
            const nextState = states[(states.indexOf(current) + 1) % 3];
            db.updateGuildConfig(ctx.chat.id, { link_action_unknown: nextState });
        } else if (data === "lnk_list") {
            const rules = db.getDb().prepare('SELECT * FROM link_rules WHERE guild_id = ?').all(ctx.chat.id);
            let msg = "📜 **Link Rules**\n";
            if (rules.length === 0) msg += "Nessuna regola.";
            else rules.slice(0, 20).forEach(r => msg += `- ${r.pattern} (${r.type})\n`);

            const backBtn = fromSettings
                ? { text: "🔙 Back to Menu", callback_data: "lnk_back_main" }
                : { text: "🔙 Back", callback_data: "lnk_main" };

            try { await ctx.editMessageText(msg, { reply_markup: { inline_keyboard: [[backBtn]] }, parse_mode: 'Markdown' }); } catch (e) { }
            return;
        } else if (data === "lnk_main") {
            return sendConfigUI(ctx, true, false);
        } else if (data === "lnk_back_main") {
            return sendConfigUI(ctx, true, true);
        }

        await sendConfigUI(ctx, true, fromSettings);
    });
}

function extractLinks(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.match(urlRegex) || [];
}

function getDomain(url) {
    try {
        const domain = new URL(url).hostname;
        return domain.replace(/^www\./, '');
    } catch (e) {
        return null;
    }
}

async function processLinks(ctx, config, links) {
    let actionToTake = null; // 'delete', 'ban', 'report_only'
    let matchedRule = null;
    let violatingLink = null;

    // Retrieve local rules
    const localRules = db.getDb().prepare('SELECT * FROM link_rules WHERE guild_id = ?').all(ctx.chat.id);

    for (const link of links) {
        const domain = getDomain(link);
        if (!domain) continue;

        // 1. Whitelist Local
        if (localRules.some(r => r.type === 'whitelist' && (domain === r.pattern || domain.endsWith('.' + r.pattern)))) {
            continue; // Safe
        }

        // 2. Blacklist Local
        const blRule = localRules.find(r => r.type === 'blacklist' && (domain === r.pattern || domain.endsWith('.' + r.pattern)));
        if (blRule) {
            actionToTake = blRule.action || 'delete';
            matchedRule = `Local BL (${blRule.pattern})`;
            violatingLink = link;
            break;
        }

        // 3. Global Intel Check
        if (config.link_sync_global) {
            const intelCheck = checkIntel(domain);
            if (intelCheck === 'whitelist') continue;
            if (intelCheck === 'blacklist') {
                actionToTake = 'delete'; // Default global BL action
                matchedRule = `Global BL`;
                violatingLink = link;
                break;
            }
        }

        // 4. Unknown
        if (!actionToTake) {
            if (config.link_action_unknown && config.link_action_unknown !== 'report_only') {
                // If action is NOT report_only (i.e. strictly delete/ban unknowns), apply it.
                // Otherwise, we default to allow unless report_only is explicit? 
                // The prompt says: 5. UNKNOWN -> link_action_unknown.
                // So if link_action_unknown is 'delete', we delete.
                actionToTake = config.link_action_unknown;
                matchedRule = 'Unknown Domain';
                violatingLink = link;
                break;
            } else {
                // If report_only or null, we might want to just report or ignore.
                // If implicit allow, actionToTake remains null.
                if (config.link_action_unknown === 'report_only') {
                    // We only report one link per message ideally
                    actionToTake = 'report_only';
                    matchedRule = 'Unknown Domain';
                    violatingLink = link;
                    break;
                }
            }
        }
    }

    if (actionToTake) {
        await executeAction(ctx, actionToTake, matchedRule, violatingLink);
    }
}

function checkIntel(domain) {
    // Check intel_data for domain
    // Schema: type='whitelist_domain' or 'blacklist_domain', value=domain
    const res = db.getDb().prepare(`
        SELECT type FROM intel_data 
        WHERE (type = 'whitelist_domain' OR type = 'blacklist_domain') 
        AND value = ? AND status = 'active'
    `).get(domain);

    if (res) {
        return res.type === 'whitelist_domain' ? 'whitelist' : 'blacklist';
    }
    return 'unknown';
}

async function executeAction(ctx, action, rule, link) {
    // Prevent duplicate actions if parallel processing? (single threaded nodejs ok)
    // But checkSpam might have run. Assuming separate calls.

    const user = ctx.from;
    const logParams = {
        guildId: ctx.chat.id,
        eventType: 'link_check',
        targetUser: user,
        executorAdmin: null,
        reason: `Link Rule: ${rule} - ${link}`,
        isGlobal: (action === 'ban')
    };

    if (action === 'delete') {
        await safeDelete(ctx, 'link-monitor');
        if (superAdmin.sendGlobalLog && rule === 'Unknown Domain') {
            superAdmin.sendGlobalLog('link_checks', `🔗 **Link Unknown**\nGruppo: ${ctx.chat.title}\nUser: @${user.username}\nLink: ${link}`);
        }
    }
    else if (action === 'ban') {
        await safeDelete(ctx, 'link-monitor');
        const banned = await safeBan(ctx, user.id, 'link-monitor');

        if (banned) {
            userReputation.modifyFlux(user.id, ctx.chat.id, -50, 'link_ban');

            if (superAdmin.forwardBanToParliament) {
                superAdmin.forwardBanToParliament({
                    user: user,
                    guildName: ctx.chat.title,
                    guildId: ctx.chat.id,
                    reason: `Link Ban: ${rule}\nLink: ${link}`,
                    evidence: ctx.message.text,
                    flux: userReputation.getLocalFlux(user.id, ctx.chat.id)
                });
            }

            logParams.eventType = 'ban';
            if (adminLogger.getLogEvent()) adminLogger.getLogEvent()(logParams);
        }
    }
    else if (action === 'report_only') {
        // Send to superadmin link checks anyway for unknowns?
        if (rule === 'Unknown Domain' && superAdmin.sendGlobalLog) {
            superAdmin.sendGlobalLog('link_checks', `🔗 **Link Unknown**\nGruppo: ${ctx.chat.title}\nUser: @${user.username}\nLink: ${link}`);
        }

        staffCoordination.reviewQueue({
            guildId: ctx.chat.id,
            source: 'Link-Mon',
            user: user,
            reason: `Link: ${rule}\n${link}`,
            messageId: ctx.message.message_id,
            content: ctx.message.text
        });
    }
}

async function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.link_enabled ? '✅ ON' : '❌ OFF';
    const sync = config.link_sync_global ? '✅ ON' : '❌ OFF';
    const act = (config.link_action_unknown || 'report_only').toUpperCase().replace(/_/g, ' ');

    const text = `🔗 **CONTROLLO LINK**\n\n` +
        `Controlla i link inviati per proteggere da scam e siti pericolosi.\n` +
        `Usa una lista globale di siti malevoli sempre aggiornata.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Blocca siti di phishing e truffe note\n` +
        `• Permette di creare una lista di siti sicuri\n` +
        `• Puoi scegliere cosa fare con i link sconosciuti\n\n` +
        `Stato: ${enabled}\n` +
        `Sync Globale: ${sync}\n` +
        `Azione (Sconosciuti): ${act}`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "lnk_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `🔗 Monitor: ${enabled}`, callback_data: "lnk_toggle" }, { text: `🌐 Sync: ${sync}`, callback_data: "lnk_sync" }],
            [{ text: `❓ Unknown: ${act}`, callback_data: "lnk_act_unk" }],
            [{ text: "➕ Aggiungi (Use /link add)", callback_data: "lnk_noop" }, { text: "📜 Lista", callback_data: "lnk_list" }],
            [closeBtn]
        ]
    };

    if (isEdit) {
        await safeEdit(ctx, text, { reply_markup: keyboard, parse_mode: 'Markdown' }, 'link-monitor');
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
}

module.exports = { register, sendConfigUI };
