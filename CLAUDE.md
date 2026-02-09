# Parent AI — WhatsApp Tracker & AI Summarizer

## What This Project Does

Connects to WhatsApp via Baileys (WhatsApp Web protocol), listens to group messages in real-time, stores them in a local SQLite database, and uses Claude AI to generate summaries. Summaries and notifications are sent to Telegram.

## Architecture

```
src/
├── index.ts                 # Entry point: boots Hono server, WhatsApp, crons
├── connection.ts            # WhatsApp Web connection via Baileys (QR auth, auto-reconnect)
├── listener.ts              # Real-time message capture, filtered by TRACKED_GROUP_IDS
├── db.ts                    # SQLite (better-sqlite3, WAL mode) — all tables and queries
├── summarize.ts             # Claude AI summarization — accepts optional custom prompts
├── agent.ts                 # WhatsApp command parser (schedule messages via natural language)
├── cli.ts                   # CLI commands (summarize, send, groups, status, discover)
├── api-client.ts            # HTTP client used by CLI to talk to the running server
├── send.ts                  # Standalone message sender (own WhatsApp connection)
│
├── lib/
│   └── app.ts               # Hono app instance, mounts all route groups
│
├── routes/
│   ├── health.routes.ts     # GET /health
│   ├── whatsapp.routes.ts   # POST /send, GET /groups, GET /status, GET /messages, etc.
│   └── summary.routes.ts    # POST /summary/daily, POST /summary/aviv_school
│
├── services/
│   ├── whatsapp.service.ts  # Socket holder (setSocket/getSocket/requireSocket)
│   ├── telegram.service.ts  # sendTelegram(text) — outbound fetch to Telegram Bot API
│   └── summary.service.ts   # rangeSummary(), dailySummary(), avivSchoolSummary()
│
├── crons/
│   ├── cron.config.ts       # Cron job definitions (config-as-code array)
│   └── cron.runner.ts       # Reads config, schedules node-cron jobs that call API endpoints
│
└── knowledge/
    ├── aviv_school_prompt.md    # Custom Claude prompt for Aviv's school summary
    └── aviv_school_schedule.md  # Aviv's class schedule (כיתה ב1)
```

## Key Patterns

### Controller/Service pattern
- **Routes** (controllers) handle HTTP requests and call services
- **Services** contain business logic (summarization, Telegram sending)
- `summarize.ts` handles the LLM call, services orchestrate it

### Cron system (config-as-code)
Cron jobs are defined in `src/crons/cron.config.ts` as a typed array. Each cron calls a local API endpoint via `fetch()`. To add a new cron: add an entry to the array and create the matching route/service.

```ts
{ name: 'daily-summary', schedule: '0 20 * * *', endpoint: '/summary/daily', method: 'POST' }
```

### Custom prompts via knowledge files
Domain-specific summaries (like Aviv's school) use markdown prompt templates in `src/knowledge/`. Templates support `{{placeholders}}` for dynamic values (today's date, schedule, etc.).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Connection status |
| POST | /send | Send a WhatsApp message |
| GET | /groups | List tracked groups with message counts |
| GET | /status?hours=24 | Connection gaps and stats |
| GET | /messages?hours=24 | Messages grouped by group |
| GET | /resolve-group?id=... | Look up a group by ID or name |
| POST | /send/scheduled | Process due scheduled messages |
| POST | /summary/daily | Summarize all groups (last 24h) -> Telegram |
| POST | /summary/aviv_school | Aviv's school summary -> Telegram |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| ANTHROPIC_API_KEY | Yes | Claude API key |
| TRACKED_GROUP_IDS | Yes | Comma-separated WhatsApp group IDs to monitor |
| TELEGRAM_BOT_TOKEN | Yes | Telegram bot token from @BotFather |
| TELEGRAM_CHAT_ID | Yes | Your personal Telegram chat ID |
| AGENT_GROUP_ID | No | WhatsApp group for agent commands |
| DB_PATH | No | SQLite path (default: ./data/messages.db) |
| API_PORT | No | Server port (default: 3033) |

## Running

```bash
npm run dev          # Start everything (WhatsApp + API + crons)
npm run groups       # List tracked groups
npm run status       # Connection health
npm run summarize -- -g "GroupName" -p day   # CLI summary
```

## Tech Stack

- **Hono** + @hono/node-server — HTTP API
- **Baileys** — WhatsApp Web protocol
- **Anthropic SDK** — Claude AI (claude-sonnet-4-20250514)
- **better-sqlite3** — Local database (WAL mode)
- **node-cron** — Scheduled jobs
- **Telegram Bot API** — Notifications (raw fetch, no library)

## Important Notes

- `markOnlineOnConnect: false` is set in connection.ts so the Baileys session does NOT show you as online and phone notifications are preserved
- Auth state is stored in `./auth_state/` — delete this folder to re-link via QR code
- "Bad MAC" errors mean stale auth state — fix by deleting `auth_state/` and re-scanning
- The database is not affected by auth resets
