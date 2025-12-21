# 📚 RWBY Bot - Documentazione Comandi

> Ultimo aggiornamento: 21 Dicembre 2025

---

## 📋 Indice

- [Comandi Utente](#-comandi-utente)
- [Comandi Admin Gruppo](#-comandi-admin-gruppo)
- [Comandi Super Admin](#-comandi-super-admin)
- [Trigger Speciali](#-trigger-speciali)
- [Pannello Settings](#-pannello-settings)

---

## 👤 Comandi Utente

Comandi disponibili per tutti gli utenti.

| Comando | Descrizione | Dove |
|---------|-------------|------|
| `/start` | Mostra il menu di benvenuto con opzioni principali | Privato/Gruppo |
| `/help` | Mostra i comandi disponibili (varia in base al ruolo) | Privato/Gruppo |
| `/myflux` | Visualizza i tuoi punti Flux e Tier in questo gruppo | Gruppo |
| `/tier` | Informazioni dettagliate sul sistema di fiducia Tier | Gruppo |

---

## ⚙️ Comandi Admin Gruppo

Comandi riservati agli amministratori del gruppo.

### 📊 Pannello Principale

| Comando | Descrizione |
|---------|-------------|
| `/settings` | **PANNELLO DI CONTROLLO PRINCIPALE** - Menu unificato per tutte le configurazioni del gruppo |

### 👮 Gestione Staff

| Comando | Sintassi | Descrizione |
|---------|----------|-------------|
| `/setstaff` | `/setstaff` | Imposta il gruppo/canale corrente come Staff Group per le segnalazioni |
| `/notes` | `/notes @user` o rispondi | Visualizza le note su un utente |
| `/setlogchannel` | `/setlogchannel` | Imposta il canale corrente come destinazione per i log di moderazione |

---

## 👑 Comandi Super Admin

> ⚠️ **Riservati ESCLUSIVAMENTE** agli ID definiti in `SUPER_ADMIN_IDS` nel file `.env`

### 🏛️ Governance Globale

| Comando | Descrizione |
|---------|-------------|
| `/gpanel` | Dashboard governance globale (statistiche, ban globali, bills) |
| `/setgstaff` | Configura il gruppo corrente come **Parliament** (crea topic automaticamente se forum) |
| `/setglog` | Imposta il canale corrente come log globale |

### 🔧 Manutenzione e Health Check

| Comando | Descrizione |
|---------|-------------|
| `/cassync` | Forza sincronizzazione manuale della lista CAS (Combot Anti-Spam) |
| `/testai` | Health check connessione AI - testa latenza e funzionamento |

### 🔗 Gestione Domini (Whitelist)

| Comando | Sintassi | Descrizione |
|---------|----------|-------------|
| `/gwhitelist` | `/gwhitelist list` | Mostra tutti i domini in whitelist globale |
| `/gwhitelist` | `/gwhitelist add <dominio>` | Aggiunge dominio alla whitelist globale |
| `/gwhitelist` | `/gwhitelist remove <dominio>` | Rimuove dominio dalla whitelist |

### 🚫 Blacklist Globale (Domini + Parole)

| Comando | Sintassi | Descrizione |
|---------|----------|-------------|
| `/gblacklist` | `/gblacklist` | Mostra riepilogo domini e parole in blacklist |
| `/gblacklist` | `/gblacklist d add <dominio>` | Aggiunge dominio alla blacklist |
| `/gblacklist` | `/gblacklist d remove <dominio>` | Rimuove dominio dalla blacklist |
| `/gblacklist` | `/gblacklist w add <parola>` | Aggiunge parola/stringa alla blacklist |
| `/gblacklist` | `/gblacklist w remove <parola>` | Rimuove parola dalla blacklist |
| `/gblacklist` | `/gblacklist d list` | Lista solo domini |
| `/gblacklist` | `/gblacklist w list` | Lista solo parole |

> **Nota:** `w` = word (parola), `d` = domain (dominio)

### 📋 Modal Patterns Globali

| Comando | Sintassi | Descrizione |
|---------|----------|-------------|
| `/gmodal` | `/gmodal list [lingua]` | Elenca modals (opzionale: filtro per lingua) |
| `/gmodal` | `/gmodal add <lang> <categoria> [azione]` | Crea nuovo modal |
| `/gmodal` | `/gmodal addpattern <lang> <categoria> <pattern>` | Aggiunge pattern a modal esistente |

### 🌐 Intel Network (Disabilitato)

| Comando | Descrizione |
|---------|-------------|
| `/intel` | Status della rete Intel federata |
| `/greport` | Segnala utente al network globale (richiede Tier 1+) |

---

## 🎯 Trigger Speciali

### Report System

Il sistema di segnalazione può essere attivato rispondendo a un messaggio con uno di questi trigger:

| Trigger | Effetto |
|---------|---------|
| `@admin` | Avvia segnalazione + analisi AI |
| `!admin` | Avvia segnalazione + analisi AI |
| `.admin` | Avvia segnalazione + analisi AI |
| `/admin` | Avvia segnalazione + analisi AI |

**Comportamento:**
1. **Con reply a messaggio**: Analizza il messaggio specifico
2. **Senza reply**: Analizza gli ultimi 10 messaggi della chat (context mode)

**Modalità disponibili** (configurabili da `/settings`):
- `AI Only` - Solo analisi AI, nessuna votazione
- `VoteBan Only` - Solo votazione community
- `AI + VoteBan` - Prima AI, se safe passa a VoteBan

---

## 🎛️ Pannello Settings

Il comando `/settings` apre un pannello interattivo con inline keyboard per configurare tutti i moduli.

### Moduli Disponibili

| Modulo | Descrizione |
|--------|-------------|
| 👋 **Welcome & Captcha** | Sistema di benvenuto con captcha multi-tipo |
| 🚫 **Blacklist** | Lista nera globale (CAS + ban interni Parliament) |
| 🔗 **Link** | Whitelist/Blacklist domini, azione su link sconosciuti |
| 🌐 **Lingua** | Filtro lingua (blocca lingue non permesse) |
| 🤬 **Parole Vietate** | Blacklist keyword con regex |
| 📋 **Modals** | Pattern spam predefiniti per lingua/categoria |
| 🔞 **NSFW** | Analisi AI foto/video/GIF per contenuti adulti |
| ✏️ **Anti-Edit** | Monitora modifiche sospette (link injection) |
| 📋 **Report** | Sistema segnalazioni (AI + VoteBan) |
| 🤖 **AI Mod** | Moderazione AI semantica (ultima linea di difesa) |
| 👮 **Staff** | Configurazione gruppo staff |
| 📜 **Logger** | Log azioni di moderazione |
| 🌍 **Lingua UI** | Cambia lingua interfaccia bot |

---

## 📊 Sistema Tier/Flux

Il bot utilizza un sistema di reputazione basato su punti (Flux) che determina il Tier dell'utente:

| Tier | Nome | Flux | Privilegi |
|------|------|------|-----------|
| 0 | Ombra | 0-99 | Tutti i controlli attivi, no link/forward |
| 1 | Scudiero | 100-299 | Bypass profiler, può editare |
| 2 | Guardiano | 300-499 | Bypass anti-spam, keyword, link |
| 3 | Sentinella | 500+ | Bypass quasi tutti i controlli |

**Guadagnare Flux:**
- +1 per messaggio (max 1 ogni 6 min)
- +1 daily bonus

**Perdere Flux:**
- -50 per spam
- -50 per link pericolosi
- -100 per contenuti vietati

---

## 🏛️ Parliament Topics

Quando configuri Parliament con `/setgstaff` in un forum, vengono creati automaticamente questi topic:

| Topic | Contenuto |
|-------|-----------|
| 🔨 Bans | Ban globali eseguiti |
| 📜 Bills | Proposte pending |
| 📋 Logs | Log di sistema |
| 📥 Join Logs | Ingressi/uscite gruppi |
| 🆕 Add Group | Nuovi gruppi aggiunti |
| 🖼️ Image Spam | Analisi AI immagini |
| 🔗 Link Checks | Verifica link sconosciuti |

---

## ⚠️ Note Importanti

1. **Tutti i moduli sono disabilitati di default** - Attiva solo quelli necessari
2. **Staff Group richiesto** per la modalità REPORT_ONLY
3. **SUPER_ADMIN_IDS** deve essere configurato in `.env` per i comandi globali
4. **CAS sincronizza ogni 24h** automaticamente
5. **Ban interni sincronizzano immediatamente** quando un gruppo abilita la blacklist
