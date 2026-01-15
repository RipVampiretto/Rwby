# 🔀 Multi-Instance Deployment

Guida per eseguire multiple istanze del bot con lo stesso codebase e database condiviso.

## Architettura

```
┌─────────────────┐     ┌─────────────────┐
│  Bot RWBY       │     │  Bot SafeJoin   │
│  .env.rwby      │     │  .env.safejoin  │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
              ┌──────▼──────┐
              │  PostgreSQL │
              │  (condiviso)│
              └─────────────┘
```

## Quick Start

### 1. Crea i file `.env`

**`.env.rwby`** - Bot RWBY
```env
BOT_INSTANCE=rwby
BOT_TOKEN=token_del_bot_rwby
# ... resto config (DB, AI, etc.)
```

**`.env.safejoin`** - Bot SafeJoin
```env
BOT_INSTANCE=safejoin
BOT_TOKEN=token_del_bot_safejoin
# ... stessa config DB
```

### 2. Avvia

```bash
# Bot RWBY
BOT_INSTANCE=rwby node index.js

# Bot SafeJoin
BOT_INSTANCE=safejoin node index.js
```

Il codice carica automaticamente `.env.rwby` o `.env.safejoin` in base a `BOT_INSTANCE`.

## Deploy con PM2

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'rwby',
      script: 'index.js',
      env: { BOT_INSTANCE: 'rwby' }
    },
    {
      name: 'safejoin',
      script: 'index.js',
      env: { BOT_INSTANCE: 'safejoin' }
    }
  ]
};
```

```bash
pm2 start ecosystem.config.js
```

## Feature Flags per Istanza

In `src/utils/feature-flags.js`:

```javascript
const flags = {
    // Abilitato OVUNQUE
    globalBlacklist: true,
    
    // Solo RWBY
    aiDailyRecap: ['rwby'],
    
    // Solo SafeJoin
    customFeature: ['safejoin'],
};
```

## Dati Condivisi

| Tabella | Condivisa | Note |
|---------|-----------|------|
| `global_blacklist` | ✅ | Ban globali sincronizzati |
| `users` | ✅ | Cache utenti |
| `guilds` | ✅ | Configurazioni gruppi |
