# Parent AI — WhatsApp Tracker & AI Summarizer

## What This Project Does

Connects to WhatsApp via Baileys (WhatsApp Web protocol), listens to group messages in real-time, stores them in a local SQLite database, and uses Gemini AI to generate summaries and execute scheduled agent tasks. A dashboard allows managing tasks, knowledge, and viewing run history. Notifications are sent to Telegram.

## First-Time Setup Guide

If the user is setting up this project for the first time, guide them through these steps:

### 1. Prerequisites
- Node.js 18+ installed
- A WhatsApp account (will be linked via QR code)
- A Gemini API key (from aistudio.google.com/apikey) — configured via the dashboard Settings page
- A Telegram bot token (create one via @BotFather on Telegram)
- Your Telegram chat ID (send /start to @userinfobot on Telegram)

### 2. Installation
```bash
git clone <repo-url> && cd parent-ai
cp .env.example .env
# Edit .env with your API keys and configuration
npm install
```

### 3. Configure .env
All required variables are in `.env.example`. The critical ones:
- `TRACKED_GROUP_IDS` — WhatsApp group IDs to monitor (discover them in step 4)
- `TELEGRAM_BOT_TOKEN` — from @BotFather
- `TELEGRAM_CHAT_ID` — your personal chat ID

### 4. Link WhatsApp
```bash
npm run dev:listener
```
A QR code appears in the terminal. Scan it with WhatsApp (Settings → Linked Devices → Link a Device). After linking, the listener saves auth state to `./auth_state/` so future restarts reconnect automatically.

Once connected, you'll see group messages in the console. Note the group IDs you want to track — either add them to `TRACKED_GROUP_IDS` in `.env` for initial seeding, or toggle tracking via the dashboard or API (`PUT /resolve-group`).

### 5. Start Services
```bash
npm run dev:api          # API server on port 3033
npm run dev:telegram     # Telegram bot
npm run dev:cron         # Scheduled task runner
npm run dev:dashboard    # Dashboard on port 3000
```

### 6. Customize for Your Child
The project ships with example knowledge files in `packages/shared/knowledge/`:
- `example_school_prompt.md` — template for school summary prompts
- `example_school_schedule.md` — template for weekly schedule

Copy and customize these for your child's school. Knowledge files are auto-seeded to the database on API startup. You can also manage knowledge entries via the dashboard.

Create tasks in the dashboard with prompts that reference your knowledge entries and WhatsApp group IDs.

## Architecture — Monorepo

```
packages/
├── shared/              # Shared DB layer, types, media download, knowledge files
│   ├── src/
│   │   ├── db.ts        # SQLite (better-sqlite3, WAL mode) — all tables and queries
│   │   ├── media.ts     # downloadMedia() via Baileys downloadMediaMessage
│   │   └── index.ts     # Re-exports
│   └── knowledge/       # Template knowledge files (seeded to DB on startup)
│
├── listener/            # WhatsApp connection + message capture
│   └── src/
│       ├── index.ts     # Entry: connects to WhatsApp, sets up listener
│       ├── connection.ts # Baileys connection (QR auth, auto-reconnect)
│       └── listener.ts  # Real-time message capture, filtered by TRACKED_GROUP_IDS
│
├── api/                 # Hono API + generic AI agent
│   └── src/
│       ├── index.ts     # Entry: Hono serve on port 3033
│       ├── app.ts       # Hono app, mounts all route groups
│       ├── routes/      # REST endpoints
│       ├── services/    # Business logic (summarization, Telegram, TTS)
│       └── agents/
│           ├── generic.agent.ts  # Agentic loop using @google/genai (Gemini)
│           └── tool-registry.ts  # Tool definitions + implementations
│
├── telegram/            # grammY Telegram bot
│   └── src/
│       ├── index.ts     # Entry: bot.start() with long polling
│       ├── bot.ts       # Bot instance + feature registration
│       ├── api-client.ts # Typed HTTP client for api service
│       └── features/
│           ├── summary.ts # /summary, /report, /today commands
│           ├── status.ts  # /status, /groups commands
│           └── chat.ts    # Free-text → generic agent (all tools available)
│
├── cron/                # Scheduled task runner
│   └── src/
│       ├── index.ts     # Entry: starts cron runner
│       └── cron.runner.ts # Polls DB for due jobs, fires HTTP calls
│
├── tts/                 # Kokoro TTS service (Python/Flask)
│   └── app.py           # POST /tts → WAV audio generation
│
└── dashboard/           # Next.js admin dashboard
    └── src/app/
        ├── layout.tsx, sidebar.tsx   # Shell with sidebar navigation
        ├── tasks/                    # Task CRUD, card grid, full-screen form
        ├── runs/                     # Global task run history
        ├── knowledge/                # Knowledge base CRUD
        ├── messages/                 # WhatsApp message viewer
        └── components/
            └── schedule-input.tsx    # Cron schedule input with AI translation
```

## Key Patterns

### Monorepo with npm workspaces
- Root `package.json` defines `"workspaces": ["packages/*"]`
- Internal deps use `"@parent-ai/shared": "*"`
- Each package has its own `package.json`, `tsconfig.json`
- Entry points use dynamic imports to ensure `.env` loads before modules read `process.env`

### Controller/Service pattern
- **Routes** (controllers) handle HTTP requests and call services
- **Services** contain business logic (summarization, Telegram sending)
- `summarize.ts` handles the LLM call, services orchestrate it

### Generic AI Agent (@google/genai — Gemini)
A single generic agent executes any task defined with a prompt in the dashboard — no code changes needed for new scheduled tasks. Every run uses one fixed model (`GEMINI_MODEL` in `gemini.service.ts`, currently `gemini-3.7-flash`) — there is no per-task model tier.

**Agent loop** (`generic.agent.ts`):
1. Takes `{ taskId, prompt, image?, audio? }` from a cron_job row (or ad-hoc)
2. Injects template variables (`{{today}}`, `{{tomorrow}}`, `{{date}}`, `{{datetime}}`)
3. Calls `ai.models.generateContent()` with `functionDeclarations` tools, max 20 iterations
4. On `response.functionCalls` present: executes tools, appends `functionResponse` parts, continues
5. Records steps and token usage in `task_runs` table

**Tool registry** (`tool-registry.ts`): `getMessages`, `transcribeImage`, `sendTelegram`, `sendTelegramAudio`, `listKnowledge`, `getKnowledge`, `getActionItems`, `createActionItem`, `createCalendarEvent`, `createTask`, `listTasks`

**Ad-hoc agent** (`POST /agent/run`): Takes `{ prompt?, image?, audio? }`. Used by the Telegram bot for free-text chat, photos, and voice messages — every message goes through the full agent with all tools. Both `image` and `audio` (base64 + mediaType) are passed directly to Gemini as `inlineData` parts alongside the prompt/caption — Gemini transcribes/understands audio natively, no separate STT step.

### DB-driven task system
Tasks (cron_jobs) are managed via the dashboard or API. Each task has:
- `name`, `schedule` (cron expression), `prompt` (agent instructions), `enabled`
- Cron runner polls every 60s, fires matching tasks via `POST /task/:id/execute`
- Legacy tasks (no prompt) fire via their `endpoint`/`method` directly

### Knowledge base
Markdown documents stored in the `knowledge` DB table. Seeded from `packages/shared/knowledge/*.md` on startup (INSERT OR IGNORE — won't overwrite). Agents can read knowledge via `listKnowledge` and `getKnowledge` tools.

### grammY Telegram bot
- **Commands**: `/report` (agent school report), `/today` (today's schedule), `/summary` (all groups), `/status`, `/groups`
- **Free-text chat**: Every message is sent to the generic agent via `POST /agent/run` — full tool access (messages, images, knowledge, Telegram, TTS audio, calendar)
- `/report` and `/today` execute tasks by name via `POST /task/:id/execute`
- Calls api service via HTTP (no direct DB access)

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Server health check |
| GET | /groups | List tracked groups with message counts |
| GET | /status?hours=24 | Connection gaps and stats |
| GET | /messages?hours=24 | Messages grouped by group |
| GET | /resolve-group?id=... | Look up a group by ID or name |
| POST | /summary/daily | Summarize all groups (last 24h) → Telegram |
| POST | /summary/school | School summary (configurable groups/prompts) |
| POST | /agent/run | Ad-hoc agent execution (body: `{ prompt }`) |
| GET | /cron-jobs | List tasks (?enabled=true, ?name=...) |
| POST | /cron-jobs | Create task |
| PUT | /cron-jobs/:id | Update task |
| DELETE | /cron-jobs/:id | Delete task |
| POST | /cron-jobs/ai | AI-translate free text → cron expression |
| POST | /task/:id/execute | Execute task via generic agent |
| GET | /task-runs | List runs (?taskId=, ?limit=) |
| GET | /task-runs/:id | Single run with full steps |
| GET | /knowledge | List knowledge entries |
| GET | /knowledge/:id | Get knowledge with content |
| POST | /knowledge | Create knowledge entry |
| PUT | /knowledge/:id | Update knowledge entry |
| DELETE | /knowledge/:id | Delete knowledge entry |

## DB Tables

- `groups` — WhatsApp group metadata
- `messages` — WhatsApp messages (text, images, reactions)
- `connection_log` — WhatsApp connection state tracking
- `cron_jobs` — Task definitions (schedule, prompt, model, enabled)
- `knowledge` — Knowledge base documents (name, content)
- `task_runs` — Agent execution history (steps_json, token_usage, success/error)
- `action_items` — Extracted action items from messages
- `_meta` — Internal flags (seed tracking)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| GEMINI_API_KEY | No | Gemini API key — fallback only; normally set via dashboard Settings (stored in DB) |
| TRACKED_GROUP_IDS | No | Comma-separated WhatsApp group IDs to seed as tracked on startup (after that, manage via dashboard) |
| TELEGRAM_BOT_TOKEN | Yes | Telegram bot token from @BotFather |
| TELEGRAM_CHAT_ID | Yes | Your personal Telegram chat ID |
| DB_PATH | No | SQLite path (default: ./data/messages.db) |
| API_PORT | No | Server port (default: 3033) |
| API_URL | No | API base URL for telegram/cron/dashboard (default: http://localhost:3033) |
| TTS_URL | No | TTS service URL (default: http://localhost:5050) |
| TTS_API_TOKEN | No | TTS service auth token |
| LOCATION_LAT | No | Latitude for weather data (default: 32.79) |
| LOCATION_LON | No | Longitude for weather data (default: 34.99) |

## Running

```bash
# Individual packages
npm run dev:listener     # WhatsApp connection + message capture
npm run dev:api          # Hono API server (with --watch auto-reload)
npm run dev:telegram     # Telegram bot
npm run dev:cron         # Cron job runner
npm run dev:dashboard    # Next.js dashboard (Turbopack HMR)
npm run dev:tts          # Kokoro TTS service

# CLI
npm run cli -- groups    # List tracked groups
npm run cli -- status    # Connection health
npm run cli -- summarize -g "GroupName" -p day
```

## Docker Deployment

```bash
docker compose up -d                # Start all services
docker compose up -d api            # Start just api
docker compose logs -f listener     # Watch listener logs

# Remote deployment (set MAC_MINI_HOST env var)
MAC_MINI_HOST=user@your-server ./deploy.sh all
MAC_MINI_HOST=user@your-server ./deploy.sh api
```

## Tech Stack

- **Hono** + @hono/node-server — HTTP API
- **Baileys** — WhatsApp Web protocol
- **@google/genai** — Gemini AI agent workflows with function calling, vision, native audio understanding, summarization
- **grammY** — Telegram bot framework
- **better-sqlite3** — Local database (WAL mode)
- **Next.js** — Admin dashboard (App Router, Turbopack)
- **Kokoro** — Local TTS engine (Python), for sending voice replies
- **googleapis** — Google Calendar + Google Tasks (shared OAuth client/token, configured in Settings)
- **cronstrue** + **cron-parser** — Human-readable cron descriptions + scheduling

## Important Notes

- `markOnlineOnConnect: false` is set in connection.ts — Baileys does NOT show you as online, phone notifications are preserved
- Auth state is stored in `./auth_state/` — delete to re-link via QR code
- "Bad MAC" errors mean stale auth state — fix by deleting `auth_state/` and re-scanning
- Database is not affected by auth resets
- SQLite WAL mode allows concurrent reads (api) + writes (listener) safely
- In Docker, volumes are shared between listener and api containers
- Knowledge is seeded from `packages/shared/knowledge/*.md` on every API startup (INSERT OR IGNORE)
- DB migrations run automatically on startup (column detection via pragma table_info)
- The Telegram bot's free-text chat (text, photos, and voice messages) goes through the full generic agent — same tools as scheduled tasks
