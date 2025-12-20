// ============================================================================
// LINK MONITOR MODULE
// ============================================================================
// SCOPO: Controllo link/URL nei messaggi con whitelist/blacklist domini GLOBALI.
// Integrato con IntelNetwork per blacklist/whitelist globale.
// Link sconosciuti vengono inviati al gruppo SuperAdmin per review.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: guild_config (campi link)
// ├── link_enabled: INTEGER (0/1, DEFAULT 1)
// ├── link_sync_global: INTEGER (0/1, DEFAULT 1)
// └── link_tier_bypass: INTEGER (DEFAULT 2)
//
// GLOBAL INTEL:
// ├── intel_data.type = 'whitelist_domain' → PASS
// └── intel_data.type = 'blacklist_domain' → DELETE
//
// UNKNOWN: → Forward to SuperAdmin Parliament for review

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

        // Tier bypass check
        const tierBypass = config.link_tier_bypass ?? 2;
        if (ctx.userTier !== undefined && ctx.userTier >= tierBypass) return next();

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
        } else if (data === "lnk_tier") {
            // Cycle through 0, 1, 2, 3
            const current = config.link_tier_bypass ?? 2;
            const next = (current + 1) % 4;
            db.updateGuildConfig(ctx.chat.id, { link_tier_bypass: next });
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
    for (const link of links) {
        const domain = getDomain(link);
        if (!domain) continue;

        // Check Global Intel only
        if (config.link_sync_global) {
            const intelCheck = checkIntel(domain);

            if (intelCheck === 'whitelist') {
                continue; // Safe, pass through
            }

            if (intelCheck === 'blacklist') {
                // Blacklisted domain - delete message
                await safeDelete(ctx, 'link-monitor');

                // Log the action
                if (adminLogger.getLogEvent()) {
                    adminLogger.getLogEvent()({
                        guildId: ctx.chat.id,
                        eventType: 'link_delete',
                        targetUser: ctx.from,
                        reason: `Blacklisted domain: ${domain}`,
                        isGlobal: false
                    });
                }

                // Log to super admin
                if (superAdmin.sendGlobalLog) {
                    superAdmin.sendGlobalLog('link_checks', `🚫 **Link Blacklist**\nGruppo: ${ctx.chat.title}\nUser: @${ctx.from.username || ctx.from.first_name}\nLink: ${link}\nDominio: ${domain}`);
                }
                return;
            }
        }

        // Unknown domain - forward to Parliament for review (don't delete)
        if (superAdmin.forwardLinkCheck) {
            superAdmin.forwardLinkCheck({
                user: ctx.from,
                guildName: ctx.chat.title,
                guildId: ctx.chat.id,
                messageId: ctx.message.message_id,
                link: link
            });
        }

        // Log unknown
        if (superAdmin.sendGlobalLog) {
            superAdmin.sendGlobalLog('link_checks', `🔗 **Link Unknown**\nGruppo: ${ctx.chat.title}\nUser: @${ctx.from.username || ctx.from.first_name}\nLink: ${link}\nDominio: ${domain}`);
        }

        // Only report first unknown link per message
        return;
    }
}

function checkIntel(domain) {
    // Check intel_data for domain
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

async function sendConfigUI(ctx, isEdit = false, fromSettings = false) {
    const config = db.getGuildConfig(ctx.chat.id);
    const enabled = config.link_enabled ? '✅ ON' : '❌ OFF';
    const sync = config.link_sync_global ? '✅ ON' : '❌ OFF';
    const tierBypass = config.link_tier_bypass ?? 2;

    const text = `🔗 **CONTROLLO LINK**\n\n` +
        `Controlla i link inviati per proteggere da scam e siti pericolosi.\n` +
        `Usa una lista globale di siti malevoli sempre aggiornata.\n\n` +
        `ℹ️ **Info:**\n` +
        `• Blocca siti di phishing e truffe note\n` +
        `• Link sconosciuti vengono segnalati ai SuperAdmin\n\n` +
        `Stato: ${enabled}\n` +
        `Bypass da Tier: ${tierBypass}+\n` +
        `Sync Globale: ${sync}`;

    const closeBtn = fromSettings
        ? { text: "🔙 Back", callback_data: "settings_main" }
        : { text: "❌ Chiudi", callback_data: "lnk_close" };

    const keyboard = {
        inline_keyboard: [
            [{ text: `🔗 Monitor: ${enabled}`, callback_data: "lnk_toggle" }],
            [{ text: `👤 Bypass Tier: ${tierBypass}+`, callback_data: "lnk_tier" }],
            [{ text: `🌐 Sync Globale: ${sync}`, callback_data: "lnk_sync" }],
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
