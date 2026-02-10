# Parent AI — WhatsApp Tracker & AI Summarizer

## What This Project Does

Connects to WhatsApp via Baileys (WhatsApp Web protocol), listens to group messages in real-time, stores them in a local SQLite database, and uses Claude AI to generate summaries. Summaries and notifications are sent to Telegram. An AI agent can transcribe images (homework photos) and generate structured daily reports.

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
├── api/                 # Hono API + AI agent workflows
│   └── src/
│       ├── index.ts     # Entry: Hono serve on port 3033
│       ├── app.ts       # Hono app, mounts all route groups
│       ├── routes/
│       │   ├── health.routes.ts    # GET /health
│       │   ├── whatsapp.routes.ts  # GET /groups, /status, /messages, /resolve-group
│       │   └── summary.routes.ts   # POST /summary/daily, /summary/aviv_school, /summary/agent/daily-report
│       ├── services/
│       │   ├── summarize.ts        # Claude AI summarization with custom prompts
│       │   ├── summary.service.ts  # rangeSummary(), dailySummary(), avivSchoolSummary()
│       │   └── telegram.service.ts # sendTelegram(text) via Bot API fetch
│       └── agents/
│           ├── daily-report.agent.ts # Vercel AI SDK generateText + tools orchestrator
│           └── tools/
│               ├── get-messages.tool.ts     # Fetch messages from DB
│               ├── transcribe-image.tool.ts # Download image + Claude vision
│               └── send-telegram.tool.ts    # Send result to Telegram
│
├── telegram/            # grammY Telegram bot
│   └── src/
│       ├── index.ts     # Entry: bot.start() with long polling
│       ├── bot.ts       # Bot instance + feature registration
│       ├── api-client.ts # Typed HTTP client for api service
│       └── features/
│           ├── summary.ts # /summary, /aviv commands
│           ├── status.ts  # /status, /groups commands
│           └── chat.ts    # Free-text AI chat (Vercel AI SDK + tools)
│
└── cron/                # Scheduled task runner
    └── src/
        ├── index.ts     # Entry: starts cron runner
        ├── cron.config.ts # Job definitions (config-as-code array)
        └── cron.runner.ts # Fires HTTP calls to api service
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

### AI Agent workflow (Vercel AI SDK)
The daily report agent uses `generateText` with tool calling:
1. Fetches messages from school WhatsApp groups
2. Detects images → transcribes them via Claude vision (homework photos)
3. Combines messages + transcriptions + school schedule → Hebrew report
4. Sends report to Telegram

Tools: `getMessages`, `transcribeImage`, `sendTelegram`

### grammY Telegram bot
- **Commands**: `/aviv` (agent report), `/summary` (all groups), `/status`, `/groups`
- **Free-text chat**: AI-powered with tools — understands natural language requests
- Calls api service via HTTP (no direct DB access)

### Cron system (config-as-code)
Jobs defined in `packages/cron/src/cron.config.ts`. Each calls an API endpoint via `fetch()`.

### Custom prompts via knowledge files
Domain-specific summaries use markdown templates in `packages/shared/knowledge/`. Templates support `{{placeholders}}` for dynamic values.

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
| POST | /summary/agent/daily-report | AI agent daily report → Telegram |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| ANTHROPIC_API_KEY | Yes | Claude API key |
| TRACKED_GROUP_IDS | Yes | Comma-separated WhatsApp group IDs to monitor |
| TELEGRAM_BOT_TOKEN | Yes | Telegram bot token from @BotFather |
| TELEGRAM_CHAT_ID | Yes | Your personal Telegram chat ID |
| DB_PATH | No | SQLite path (default: ./data/messages.db) |
| API_PORT | No | Server port (default: 3033) |
| API_URL | No | API base URL for telegram/cron (default: http://localhost:3033) |

## Running

```bash
# Individual packages
npm run dev:listener     # WhatsApp connection + message capture
npm run dev:api          # Hono API server
npm run dev:telegram     # Telegram bot
npm run dev:cron         # Cron job runner

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
- **Vercel AI SDK** + @ai-sdk/anthropic — AI agent workflows with tool calling
- **Anthropic SDK** — Direct Claude calls (summarization, vision)
- **grammY** — Telegram bot framework
- **better-sqlite3** — Local database (WAL mode)
- **node-cron** — Scheduled jobs

## Important Notes

- `markOnlineOnConnect: false` is set in connection.ts — Baileys does NOT show you as online, phone notifications are preserved
- Auth state is stored in `./auth_state/` — delete to re-link via QR code
- "Bad MAC" errors mean stale auth state — fix by deleting `auth_state/` and re-scanning
- Database is not affected by auth resets
- SQLite WAL mode allows concurrent reads (api) + writes (listener) safely
- In Docker, `db-data` volume is shared between listener and api containers
