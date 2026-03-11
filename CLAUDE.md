# Parent AI — WhatsApp Tracker & AI Summarizer

## What This Project Does

Connects to WhatsApp via Baileys (WhatsApp Web protocol), listens to group messages in real-time, stores them in a local SQLite database, and uses Claude AI to generate summaries and execute scheduled agent tasks. A dashboard allows managing tasks, knowledge, and viewing run history. Notifications are sent to Telegram.

## Architecture — Monorepo

```
packages/
├── shared/              # Shared DB layer, types, media download, knowledge files
│   ├── src/
│   │   ├── db.ts        # SQLite (better-sqlite3, WAL mode) — all tables and queries
│   │   ├── media.ts     # downloadMedia() via Baileys downloadMediaMessage
│   │   └── index.ts     # Re-exports
│   └── knowledge/
│       ├── aviv_school_prompt.md     # Hebrew prompt template with {{placeholders}}
│       └── aviv_school_schedule.md   # Aviv's class ב1 weekly schedule
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
│       ├── routes/
│       │   ├── health.routes.ts      # GET /health
│       │   ├── whatsapp.routes.ts    # GET /groups, /status, /messages, /resolve-group
│       │   ├── summary.routes.ts     # POST /summary/daily, /summary/aviv_school
│       │   ├── cron.routes.ts        # CRUD /cron-jobs, POST /cron-jobs/ai
│       │   ├── task.routes.ts        # POST /task/:id/execute, GET /task-runs
│       │   └── knowledge.routes.ts   # CRUD /knowledge
│       ├── services/
│       │   ├── summarize.ts          # Claude AI summarization with custom prompts
│       │   ├── summary.service.ts    # rangeSummary(), dailySummary(), avivSchoolSummary()
│       │   └── telegram.service.ts   # sendTelegram(text) via Bot API fetch
│       └── agents/
│           ├── generic.agent.ts      # Agentic loop using @anthropic-ai/sdk
│           └── tool-registry.ts      # Tool definitions (JSON Schema) + implementations
│
├── telegram/            # grammY Telegram bot
│   └── src/
│       ├── index.ts     # Entry: bot.start() with long polling
│       ├── bot.ts       # Bot instance + feature registration
│       ├── api-client.ts # Typed HTTP client for api service
│       └── features/
│           ├── summary.ts # /summary, /aviv, /today commands
│           ├── status.ts  # /status, /groups commands
│           └── chat.ts    # Free-text AI chat (@anthropic-ai/sdk + tools)
│
├── cron/                # Scheduled task runner
│   └── src/
│       ├── index.ts     # Entry: starts cron runner
│       └── cron.runner.ts # Polls DB for due jobs, fires HTTP calls
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

### Generic AI Agent (@anthropic-ai/sdk)
A single generic agent executes any task defined with a prompt in the dashboard — no code changes needed for new scheduled tasks.

**Agent loop** (`generic.agent.ts`):
1. Takes `{ taskId, prompt, model }` from a cron_job row
2. Injects template variables (`{{today}}`, `{{tomorrow}}`, `{{date}}`, `{{datetime}}`)
3. Calls `anthropic.messages.create()` with tools, max 10 iterations
4. On `stop_reason === 'tool_use'`: executes tools, appends results, continues
5. Records steps and token usage in `task_runs` table

**Tool registry** (`tool-registry.ts`): `getMessages`, `transcribeImage`, `sendTelegram`, `listKnowledge`, `getKnowledge`

### DB-driven task system
Tasks (cron_jobs) are managed via the dashboard or API. Each task has:
- `name`, `schedule` (cron expression), `prompt` (agent instructions), `model` (sonnet/haiku/opus), `enabled`
- Cron runner polls every 60s, fires matching tasks via `POST /task/:id/execute`
- Legacy tasks (no prompt) fire via their `endpoint`/`method` directly

### Knowledge base
Markdown documents stored in the `knowledge` DB table. Seeded from `packages/shared/knowledge/*.md` on startup. Agents can read knowledge via `listKnowledge` and `getKnowledge` tools.

### grammY Telegram bot
- **Commands**: `/aviv` (agent report), `/today` (today's schedule), `/summary` (all groups), `/status`, `/groups`
- **Free-text chat**: AI-powered with tools using `@anthropic-ai/sdk` — understands natural language requests
- `/aviv` and `/today` execute tasks by name via `POST /task/:id/execute`
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
| POST | /summary/aviv_school | Aviv's school summary → Telegram |
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
- `scheduled_messages` — (legacy) scheduled message queue
- `cron_jobs` — Task definitions (schedule, prompt, model, enabled)
- `knowledge` — Knowledge base documents (name, content)
- `task_runs` — Agent execution history (steps_json, token_usage, success/error)
- `_meta` — Internal flags (seed tracking)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| ANTHROPIC_API_KEY | Yes | Claude API key |
| TRACKED_GROUP_IDS | Yes | Comma-separated WhatsApp group IDs to monitor |
| TELEGRAM_BOT_TOKEN | Yes | Telegram bot token from @BotFather |
| TELEGRAM_CHAT_ID | Yes | Your personal Telegram chat ID |
| DB_PATH | No | SQLite path (default: ./data/messages.db) |
| API_PORT | No | Server port (default: 3033) |
| API_URL | No | API base URL for telegram/cron/dashboard (default: http://localhost:3033) |

## Running

```bash
# Individual packages
npm run dev:listener     # WhatsApp connection + message capture
npm run dev:api          # Hono API server (with --watch auto-reload)
npm run dev:telegram     # Telegram bot
npm run dev:cron         # Cron job runner
npm run dev:dashboard    # Next.js dashboard (Turbopack HMR)

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

# Deploy to Mac Mini
./deploy.sh all          # Deploy all services
./deploy.sh api          # Deploy just api
```

## Tech Stack

- **Hono** + @hono/node-server — HTTP API
- **Baileys** — WhatsApp Web protocol
- **@anthropic-ai/sdk** — AI agent workflows with tool calling, vision, summarization
- **grammY** — Telegram bot framework
- **better-sqlite3** — Local database (WAL mode)
- **Next.js** — Admin dashboard (App Router, Turbopack)
- **cronstrue** + **cron-parser** — Human-readable cron descriptions + scheduling

## Syncing Renovation Data to Remote (`brain.local`)

The Mac Mini (`ilyalibin@brain.local`) runs the production services. To push local renovation tables to remote:

```bash
# 1. Stop remote API
ssh ilyalibin@brain.local "cd ~/parent-ai && /usr/local/bin/docker compose stop api"

# 2. Drop + recreate renovation tables from local (schema + data)
ssh ilyalibin@brain.local "sqlite3 ~/parent-ai/data/messages.db 'DROP TABLE IF EXISTS renovation_workers; DROP TABLE IF EXISTS renovation_phases; DROP TABLE IF EXISTS renovation_jobs;'"
sqlite3 data/messages.db ".dump renovation_jobs" ".dump renovation_workers" ".dump renovation_phases" \
  | ssh ilyalibin@brain.local "sqlite3 ~/parent-ai/data/messages.db"

# 3. Sync renovation settings
ssh ilyalibin@brain.local "sqlite3 ~/parent-ai/data/messages.db \"DELETE FROM integrations WHERE type='renovation_settings';\""
sqlite3 data/messages.db ".dump integrations" | grep "renovation_settings" \
  | ssh ilyalibin@brain.local "sqlite3 ~/parent-ai/data/messages.db"

# 4. Restart remote API
ssh ilyalibin@brain.local "cd ~/parent-ai && /usr/local/bin/docker compose up -d api"
```

**Why drop+recreate:** Local and remote schemas can drift (migration order, ALTER TABLE column positions). `.dump` recreates with exact local schema, avoiding column order mismatches.

## Important Notes

- `markOnlineOnConnect: false` is set in connection.ts — Baileys does NOT show you as online, phone notifications are preserved
- Auth state is stored in `./auth_state/` — delete to re-link via QR code
- "Bad MAC" errors mean stale auth state — fix by deleting `auth_state/` and re-scanning
- Database is not affected by auth resets
- SQLite WAL mode allows concurrent reads (api) + writes (listener) safely
- In Docker, `db-data` volume is shared between listener and api containers
- Knowledge is seeded from `packages/shared/knowledge/*.md` on every API startup (INSERT OR IGNORE)
- DB migrations run automatically on startup (column detection via pragma table_info)
