const logger = require('../../middlewares/logger');

const WIZARD_SESSIONS = new Map();
const WIZARD_SESSION_TTL = 300000; // 5 minutes
const WIZARD_CLEANUP_INTERVAL = 60000; // 1 minute

let cleanupInterval = null;

function init() {
    if (cleanupInterval) clearInterval(cleanupInterval);
    cleanupInterval = setInterval(() => {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, session] of WIZARD_SESSIONS.entries()) {
            if (now - (session.startedAt || 0) > WIZARD_SESSION_TTL) {
                WIZARD_SESSIONS.delete(key);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            logger.debug(
                `[keyword-monitor] Wizard cleanup: removed ${cleaned} expired sessions, ${WIZARD_SESSIONS.size} remaining`
            );
        }
    }, WIZARD_CLEANUP_INTERVAL);
}

async function handleWizardStep(ctx, sessionKey) {
    const session = WIZARD_SESSIONS.get(sessionKey);
    if (session.step === 1 && ctx.message.text) {
        session.word = ctx.message.text;
        session.step = 2;
        await ctx.reply(`\`${session.word}\` è una Regular Expression?`, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Sì', callback_data: 'wrd_wiz_regex_yes' },
                        { text: '❌ No', callback_data: 'wrd_wiz_regex_no' }
                    ]
                ]
            },
            parse_mode: 'Markdown'
        });
    }
}

module.exports = {
    init,
    WIZARD_SESSIONS,
    handleWizardStep
};
