# 📚 RWBY Bot - Documentation

## 📋 COMANDI

### 👤 Comandi Utente

| Comando | Descrizione |
|---------|-------------|
| `/start` | Menu di benvenuto |
| `/help` | Mostra comandi disponibili |
| `/myflux` | Visualizza Flux personale e Tier |
| `/tier` | Info Sistema Tier |

### ⚙️ Comandi Admin

| Comando | Descrizione |
|---------|-------------|
| `/settings` | 🎛️ **Pannello di controllo principale** |
| `/notes` | Visualizza/aggiungi note su utente |
| `/cassync` | Sync manuale CAS bans |

### 👑 Comandi SuperAdmin

> Riservati agli ID in `SUPER_ADMIN_IDS`

| Comando | Descrizione |
|---------|-------------|
| `/gpanel` | Dashboard governance globale |
| `/setgstaff` | Configura gruppo Parliament |
| `/setglog` | Imposta canale log globale |
| `/gwhitelist` | Gestisci whitelist domini |
| `/gblacklist` | Gestisci blacklist domini |
| `/gmodal` | Gestisci spam patterns globali |

---

## 📁 Struttura Moduli

```
src/features/
├── action-log/         # Logging azioni
├── edit-monitor/       # Monitoring modifiche
├── global-blacklist/   # CAS Ban + Blacklist
├── language-filter/    # Filtro lingua
├── link-filter/        # Whitelist/Blacklist link
├── media-filter/       # Analisi NSFW
├── report-system/      # Segnalazioni/Vote-ban
├── settings-menu/      # Pannello di controllo
├── spam-patterns/      # Pattern spam
├── staff-coordination/ # Coordinamento staff
├── super-admin/        # Parliament
├── user-reputation/    # Sistema Flux
├── welcome-system/     # Benvenuto & Captcha
└── word-filter/        # Keyword blacklist
```

---

## 🏛️ Sistema Tier

| Tier | Flux | Descrizione |
|------|------|-------------|
| 🌑 0 | 0-99 | Nuovi utenti |
| ⚔️ 1 | 100-299 | Utenti confermati |
| 🛡️ 2 | 300-499 | Utenti stabili |
| 👁️ 3 | 500+ | Veterani |

---

## 🐳 Docker

```bash
# Stop tutto
docker compose down

# Reset completo (⚠️ cancella dati)
docker compose down -v

# Ricostruisci e avvia
docker compose up --build -d

# Logs
docker compose logs -f
```
