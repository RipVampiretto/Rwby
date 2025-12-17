// ============================================================================
// TODO: IMPLEMENTATION PLAN - INTEL NETWORK
// ============================================================================
// SCOPO: Rete federata per condivisione intelligence tra gruppi.
// Sincronizza ban globali, blacklist link/parole, e hash immagini.
// Ogni gruppo ha un Trust Score che determina la sua influenza.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. DATA MODEL - Struttura Database SQLite
// ----------------------------------------------------------------------------
//
// TABELLA: intel_data (dati condivisi)
// ├── id: INTEGER PRIMARY KEY AUTOINCREMENT
// ├── type: TEXT
// │   └── 'ban' | 'whitelist_domain' | 'blacklist_domain' | 
// │   └── 'blacklist_word' | 'image_hash' | 'global_note'
// ├── value: TEXT (user_id per ban, dominio, parola, hash)
// ├── metadata: TEXT (JSON con dettagli aggiuntivi)
// ├── added_by_guild: INTEGER (gruppo che ha aggiunto)
// ├── added_by_user: INTEGER (staff che ha aggiunto)
// ├── trust_weight: INTEGER (peso basato su trust gruppo)
// ├── confirmations: INTEGER (quanti gruppi hanno confermato)
// ├── reports: INTEGER (quanti gruppi hanno contestato)
// ├── status: TEXT ('pending', 'active', 'revoked')
// └── created_at: TEXT (ISO timestamp)
//
// TABELLA: guild_trust (trust score per gruppo)
// ├── guild_id: INTEGER PRIMARY KEY
// ├── guild_name: TEXT
// ├── tier: INTEGER (0-3)
// │   └── 0: Nuovo, dati pendenti review
// │   └── 1: Verificato, dati auto-applicati localmente
// │   └── 2: Trusted, può proporre dati globali
// │   └── 3: Authority, dati applicati auto rete
// ├── trust_score: INTEGER (0-100)
// ├── contributions_valid: INTEGER (proposte accettate)
// ├── contributions_invalid: INTEGER (proposte rifiutate)
// ├── joined_at: TEXT (timestamp ingresso rete)
// └── last_sync: TEXT (ultimo sync dati)

// ----------------------------------------------------------------------------
// 2. SYNC MECHANISM - Sincronizzazione Real-Time
// ----------------------------------------------------------------------------
//
// EVENTI ASCOLTATI:
// ├── GLOBAL_BAN_ADD → Nuovo ban globale confermato
// ├── GLOBAL_BAN_REVOKE → Ban globale rimosso
// ├── BLACKLIST_ADD → Nuova parola/link/hash bannato
// ├── BLACKLIST_REMOVE → Rimozione da blacklist
// └── FLUX_UPDATE → Cambio significativo TrustFlux utente
//
// ON GLOBAL_BAN_ADD:
// ├── Ricevi userId e metadata
// ├── Verifica trust_weight >= threshold
// └── Se gruppo Tier 1+: applica immediatamente
//     Altrimenti: salva come pending per review

// ----------------------------------------------------------------------------
// 3. DATA PROPAGATION - Trust-Weighted
// ----------------------------------------------------------------------------
//
// Chi può aggiungere cosa:
// ├── Tier 0: Nulla (solo ricezione)
// ├── Tier 1: Proporre blacklist (pending review)
// ├── Tier 2: Blacklist auto-applicate, proporre ban globali
// └── Tier 3: Tutto auto-applicato immediatamente

// ----------------------------------------------------------------------------
// 4. BAN FORWARD INTEGRATION
// ----------------------------------------------------------------------------
//
// Quando un gruppo esegue un BAN:
// 1. Forward a SuperAdmin (vedi super-admin)
// 2. SuperAdmin può click [ 🌍 Global Ban ]
// 3. Questo triggera GLOBAL_BAN_ADD
// 4. Tutti i gruppi Tier 1+ applicano automaticamente
// 5. Gruppi Tier 0 ricevono come pending

// ----------------------------------------------------------------------------
// 5. LOCAL ADMIN REPORTING - /greport
// ----------------------------------------------------------------------------
//
// COMANDO: /greport (reply a messaggio sospetto)
// PERMESSI: Admin del gruppo
// REQUISITO: Gruppo deve essere Tier 1+
//
// FLUSSO:
// 1. Admin risponde a messaggio con /greport
// 2. Bot crea "Bill" (proposta) per SuperAdmin
// 3. Allega evidenza (messaggio originale)
// 4. SuperAdmin riceve nel topic Bills
// 5. SuperAdmin può:
//    └── Ratificare → GLOBAL_BAN_ADD
//    └── Rifiutare → Notifica gruppo, nessuna azione

// ----------------------------------------------------------------------------
// 6. CONFIGURATION UI - /intel
// ----------------------------------------------------------------------------
//
// MESSAGGIO:
// ┌────────────────────────────────────────────┐
// │ 🌐 **INTEL NETWORK STATUS**                │
// │                                            │
// │ 🏷️ Tier Gruppo: 1 (Verificato)            │
// │ 📊 Trust Score: 78/100                    │
// │ ✅ Contributi validi: 23                  │
// │ ❌ Contributi invalidi: 2                 │
// └────────────────────────────────────────────┘
//
// KEYBOARD:
// [ 🔄 Sync Ban: ON ] [ 🔄 Sync Link: ON ]
// [ 🔄 Sync Parole: ON ] [ 🔄 Sync Immagini: ON ]
// [ 📊 Statistiche Rete ]
// [ ❌ Chiudi ]
// ============================================================================
// MODULE EXPORTS
// ============================================================================

let db = null;
let _botInstance = null;

function register(bot, database) {
    db = database;
    _botInstance = bot;

    // Command: /intel
    bot.command("intel", async (ctx) => {
        if (ctx.chat.type === 'private') return;

        const member = await ctx.getChatMember(ctx.from.id);
        if (!['creator', 'administrator'].includes(member.status)) return; // Admin only

        const guildStats = getGuildTrust(ctx.chat.id);

        const tierName = ['New', 'Verified', 'Trusted', 'Authority'][guildStats.tier] || 'Unknown';

        const text = `🌐 **INTEL NETWORK STATUS**\n\n` +
            `🏷️ Tier Gruppo: ${guildStats.tier} (${tierName})\n` +
            `📊 Trust Score: ${guildStats.trust_score}/100\n` +
            `✅ Contributi validi: ${guildStats.contributions_valid}\n` +
            `❌ Contributi invalidi: ${guildStats.contributions_invalid}`;

        const keyboard = {
            inline_keyboard: [
                [{ text: "🔄 Sync Ban: ON", callback_data: "intel_noop" }, { text: "🔄 Sync Link: ON", callback_data: "intel_noop" }], // Placeholders for config
                [{ text: "❌ Chiudi", callback_data: "intel_close" }]
            ]
        };

        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'Markdown' });
    });

    // Command: /greport
    bot.command("greport", async (ctx) => {
        if (ctx.chat.type === 'private') return;
        const member = await ctx.getChatMember(ctx.from.id);
        if (!['creator', 'administrator'].includes(member.status)) return;

        if (!ctx.message.reply_to_message) {
            return ctx.reply("❌ Rispondi al messaggio (o utente) da segnalare.");
        }

        const guildStats = getGuildTrust(ctx.chat.id);
        if (guildStats.tier < 1) {
            return ctx.reply("❌ Il tuo gruppo deve essere almeno Tier 1 (Verified) per inviare report globali.");
        }

        const targetUser = ctx.message.reply_to_message.from;
        if (!targetUser) return ctx.reply("❌ Impossibile identificare l'utente target.");

        const reason = ctx.message.text.split(' ').slice(1).join(' ') || 'Suspicious activity';

        // Create Bill
        try {
            // Get parliament info
            const globalConfig = db.getDb().prepare('SELECT * FROM global_config WHERE id = 1').get();
            if (!globalConfig || !globalConfig.parliament_group_id) return ctx.reply("❌ Network non configurato.");

            let billsThread = null;
            if (globalConfig.global_topics) {
                try { billsThread = JSON.parse(globalConfig.global_topics).bills; } catch (e) { }
            }

            // Insert Bill
            const res = db.getDb().prepare(`
                INSERT INTO bills (type, target, source_guild, metadata, status)
                VALUES (?, ?, ?, ?, 'pending')
            `).run('global_ban', targetUser.id, ctx.chat.id, JSON.stringify({
                reason: reason,
                evidence: ctx.message.reply_to_message.text || 'Media/NoContent',
                reporter: ctx.from.id,
                targetUsername: targetUser.username
            }));

            // Notify Parliament
            const text = `📜 **NUOVO BILL #${res.lastInsertRowid}**\n` +
                `Da: ${ctx.chat.title}\n` +
                `Target: ${targetUser.first_name} (@${targetUser.username})\n` +
                `Reason: ${reason}\n\n` +
                `Richiede Ratifica.`;

            const keyboard = {
                inline_keyboard: [
                    [{ text: "✅ Ratifica", callback_data: `bill_yes:${res.lastInsertRowid}` }, { text: "❌ Rigetta", callback_data: `bill_no:${res.lastInsertRowid}` }]
                ]
            };

            await _botInstance.api.sendMessage(globalConfig.parliament_group_id, text, {
                message_thread_id: billsThread,
                reply_markup: keyboard,
                parse_mode: 'Markdown'
            });

            await ctx.reply("✅ Report inviato al network (Bill Created).");

        } catch (e) {
            console.error(e);
            await ctx.reply("❌ Errore invio report.");
        }
    });

    bot.on("callback_query:data", async (ctx, next) => {
        if (ctx.callbackQuery.data === 'intel_close') return ctx.deleteMessage();
        if (ctx.callbackQuery.data === 'intel_noop') return ctx.answerCallbackQuery("Feature coming soon");
        await next();
    });
}

function getGuildTrust(guildId) {
    let row = db.getDb().prepare('SELECT * FROM guild_trust WHERE guild_id = ?').get(guildId);
    if (!row) {
        // Init row
        db.getDb().prepare('INSERT INTO guild_trust (guild_id) VALUES (?)').run(guildId);
        row = db.getDb().prepare('SELECT * FROM guild_trust WHERE guild_id = ?').get(guildId);
    }
    return row;
}

module.exports = { register };
