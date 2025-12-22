const detection = require('./detection');
const actions = require('./actions');
const ui = require('./ui');
const { isAdmin, isFromSettingsMenu } = require('../../utils/error-handlers');

function registerCommands(bot, db) {
    // Middleware: language detection
    bot.on('message:text', async (ctx, next) => {
        if (ctx.chat.type === 'private') return next();

        // Wait for detection to be ready
        if (!detection.isReady()) {
            await detection.waitForReady();
            if (!detection.isReady()) return next(); // Failed to load
        }

        // Skip admins
        if (await isAdmin(ctx, 'language-monitor')) return next();

        // Config check
        const config = await db.getGuildConfig(ctx.chat.id);
        if (!config.lang_enabled) return next();

        // Tier bypass check
        const tierBypass = config.lang_tier_bypass ?? 2;
        if (tierBypass !== -1 && ctx.userTier !== undefined && ctx.userTier >= tierBypass) return next();

        // Min length check
        if (ctx.message.text.length < (config.lang_min_chars || 20)) return next();

        const rawText = ctx.message.text;
        // Strip URLs and @mentions
        const text = rawText
            .replace(/https?:\/\/[^\s]+/g, '')
            .replace(/@\w+/g, '')
            .trim();
        if (text.length === 0) return next();

        let allowed = ['it', 'en']; // Default
        if (config.allowed_languages) {
            if (Array.isArray(config.allowed_languages)) {
                allowed = config.allowed_languages;
            } else if (typeof config.allowed_languages === 'string') {
                try {
                    const parsed = JSON.parse(config.allowed_languages);
                    if (parsed.length > 0) allowed = parsed;
                } catch (e) { }
            }
        }

        // 1. Script Detection
        const scriptLang = detection.detectNonLatinScript(text);
        if (scriptLang && !allowed.includes(scriptLang)) {
            await actions.executeAction(ctx, config, scriptLang, allowed);
            return;
        }

        // 2. Franc Detection
        if (text.length >= (config.lang_min_chars || 20)) {
            const detected = await detection.detectLanguage(text);
            if (detected && !allowed.includes(detected)) {
                await actions.executeAction(ctx, config, detected, allowed);
                return;
            }
        }

        await next();
    });

    // UI Handlers
    bot.on('callback_query:data', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        if (!data.startsWith('lng_')) return next();

        const config = await db.getGuildConfig(ctx.chat.id);
        const fromSettings = isFromSettingsMenu(ctx);

        if (data === 'lng_close') return ctx.deleteMessage();

        if (data === 'lng_toggle') {
            await db.updateGuildConfig(ctx.chat.id, { lang_enabled: config.lang_enabled ? 0 : 1 });
        } else if (data === 'lng_act') {
            const acts = ['delete', 'ban', 'report_only'];
            let cur = config.lang_action || 'delete';
            if (!acts.includes(cur)) cur = 'delete';
            const nextAct = acts[(acts.indexOf(cur) + 1) % 3];
            await db.updateGuildConfig(ctx.chat.id, { lang_action: nextAct });
        } else if (data === 'lng_tier') {
            const current = config.lang_tier_bypass ?? 2;
            const tiers = [0, 1, 2, 3, -1];
            const idx = tiers.indexOf(current);
            const next = tiers[(idx + 1) % tiers.length];
            await db.updateGuildConfig(ctx.chat.id, { lang_tier_bypass: next });
        } else if (data.startsWith('lng_set:')) {
            const lang = data.split(':')[1];
            let allowed = [];
            if (config.allowed_languages) {
                if (Array.isArray(config.allowed_languages)) {
                    allowed = config.allowed_languages;
                } else if (typeof config.allowed_languages === 'string') {
                    try {
                        allowed = JSON.parse(config.allowed_languages);
                    } catch (e) { }
                }
            }
            if (allowed.length === 0) allowed = ['it', 'en'];

            if (allowed.includes(lang)) {
                if (allowed.length > 1) {
                    allowed = allowed.filter(l => l !== lang);
                }
            } else {
                allowed.push(lang);
            }
            await db.updateGuildConfig(ctx.chat.id, { allowed_languages: JSON.stringify(allowed) });
        }

        await ui.sendConfigUI(ctx, db, true, fromSettings);
    });
}

module.exports = {
    registerCommands
};
