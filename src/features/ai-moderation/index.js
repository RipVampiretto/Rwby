// TODO: IMPLEMENTATION PLAN - AI MODERATION
//
// 1. DATA MODEL (SQLite Table: 'ai_config')
//    - `guild_id`: Integer.
//    - `action_scam`: 'delete' | 'ban' | 'report'.
//    - `action_hate`: 'delete' | 'ban' | 'report'.
//    - `action_nsfw`: 'delete' | 'ban' | 'report'.
//    - `confidence_threshold`: Float (0.0-1.0).
//
// 2. INFRASTRUCTURE (Local LLM)
//    - **Provider**: LM Studio (or similar OAI-compatible local server).
//    - **Endpoint**: `http://localhost:1234/v1/chat/completions`.
//    - **Model**: Loaded in LM Studio (e.g., `hermes-2-pro-llama-3`, `mistral-7b`).
//    - **Performance**: High priority on latency. Configurable timeout (e.g., 5s).
//
// 3. WORKFLOW
//    - Check Cache.
//    - Call Local API (`fetch` to localhost:1234).
//    - Payload: system prompt + user message.
//    - Parse JSON response `{ harmful, category, confidence }`.
//    - Execute `action_[category]`.
//
// 4. ACTION HANDLER
//    - If Action == 'report':
//      - Log: "🤖 AI Detected [Category] (99%)".
//      - Post to Staff Channel with [ 🔨 Ban ] [ 🗑️ Delete ] buttons.
//
// 5. CONFIGURATION UI (`/aiconfig`)
//    - [ 🧠 Source: Localhost:1234 ] (Status Check)
//    - [ 🌡️ Sensitivity: High/Low ]
//    - [ 🎭 Context Awareness: ON ]
//    - [ 👮 Action SCAM: Report/Ban/Delete ]
//    - [ 👮 Action HATE: Report/Ban/Delete ]
