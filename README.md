# Parent AI

**WhatsApp group tracker with AI summaries, a Telegram bot, and a dashboard — built for parents who want to stay on top of school group chats.**

Parent AI connects to WhatsApp, listens to group messages in real-time, stores them locally, and uses Claude AI to generate summaries, extract homework assignments, and execute scheduled tasks. You control everything through a Telegram bot or a web dashboard.

## What It Does

- **Listens** to WhatsApp group messages in real-time via Baileys
- **Stores** messages in a local SQLite database (nothing leaves your machine)
- **Summarizes** group conversations using Claude AI
- **Runs scheduled tasks** — daily school reports, homework extraction, schedule reminders
- **Sends notifications** via Telegram (text and audio messages)
- **Dashboard** for managing tasks, knowledge base, and viewing agent run history
- **Free-text Telegram chat** — ask anything, the AI agent has access to all your WhatsApp messages and tools

## Architecture

```
┌─────────────┐     ┌──────────┐     ┌───────────┐
│  WhatsApp   │────▶│ Listener │────▶│  SQLite   │
│  (Baileys)  │     │          │     │    DB     │
└─────────────┘     └──────────┘     └─────┬─────┘
                                           │
┌─────────────┐     ┌──────────┐     ┌─────┴─────┐     ┌───────────┐
│  Telegram   │◀───▶│   Bot    │────▶│  Hono API │◀────│   Cron    │
│             │     │ (grammY) │     │  + Agent  │     │  Runner   │
└─────────────┘     └──────────┘     └─────┬─────┘     └───────────┘
                                           │
                    ┌──────────┐     ┌─────┴─────┐
                    │   TTS    │◀────│ Dashboard  │
                    │ (Kokoro) │     │ (Next.js)  │
                    └──────────┘     └───────────┘
```

Monorepo with npm workspaces: `packages/{shared, listener, api, telegram, cron, dashboard, tts}`

## Quick Start

### Prerequisites

- **Node.js 18+**
- **WhatsApp account** (will be linked via QR code)
- **Anthropic API key** from [console.anthropic.com](https://console.anthropic.com)
- **Telegram bot** — create one via [@BotFather](https://t.me/BotFather)
- **Telegram chat ID** — send `/start` to [@userinfobot](https://t.me/userinfobot)

### 1. Clone and install

```bash
git clone https://github.com/ilyalibin/parent-ai.git
cd parent-ai
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your keys:

```env
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=123456789:ABC...
TELEGRAM_CHAT_ID=123456789
TRACKED_GROUP_IDS=              # Leave empty for now, fill in after step 3
```

### 3. Link WhatsApp

```bash
npm run dev:listener
```

Scan the QR code with WhatsApp (Settings → Linked Devices → Link a Device). Once connected, you'll see group IDs in the console. Copy the IDs of groups you want to track into `TRACKED_GROUP_IDS` in `.env`, then restart the listener.

### 4. Start the services

```bash
npm run dev:api          # API server (port 3033)
npm run dev:telegram     # Telegram bot
npm run dev:cron         # Scheduled task runner
npm run dev:dashboard    # Dashboard (port 3000)
```

### 5. Customize for your child

The project ships with example knowledge templates in `packages/shared/knowledge/`:

- `example_school_prompt.md` — template for daily school report prompts
- `example_school_schedule.md` — template for weekly class schedule

Copy and customize these files with your child's details. They're automatically seeded to the database on API startup.

Then create tasks in the dashboard (or via API) with prompts that reference your knowledge entries and WhatsApp groups.

## Telegram Bot Commands

| Command | Description |
|---------|-------------|
| `/report` | Run the school daily report task |
| `/today` | Send today's schedule |
| `/summary` | Summarize all tracked groups (last 24h) |
| `/status` | System health and connection status |
| `/groups` | List tracked WhatsApp groups |
| *any text* | Free-text chat with the AI agent (full tool access) |

The free-text chat is powered by the same generic agent that runs scheduled tasks — it can read WhatsApp messages, transcribe images, look up knowledge, send Telegram messages, generate audio, and create calendar events.

## Docker Deployment

```bash
docker compose up -d              # Start all services
docker compose logs -f listener   # Watch listener logs
```

For remote deployment to another machine:

```bash
MAC_MINI_HOST=user@your-server ./deploy.sh all
```

## How the AI Agent Works

The generic agent (`packages/api/src/agents/generic.agent.ts`) is the core of the system. It:

1. Takes a prompt (from a scheduled task or free-text Telegram message)
2. Injects template variables (`{{today}}`, `{{tomorrow}}`, `{{date}}`)
3. Runs a multi-step loop with Claude, calling tools as needed
4. Records every step for debugging in the dashboard

**Available tools**: `getMessages`, `transcribeImage`, `sendTelegram`, `sendTelegramAudio`, `listKnowledge`, `getKnowledge`, `getActionItems`, `createActionItem`, `createCalendarEvent`

Tasks are fully configurable in the dashboard — no code changes needed. Write a prompt, set a cron schedule, and the agent handles the rest.

## Tech Stack

- **[Hono](https://hono.dev)** — HTTP API framework
- **[Baileys](https://github.com/WhiskeySockets/Baileys)** — WhatsApp Web protocol
- **[@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript)** — Claude AI with tool calling
- **[grammY](https://grammy.dev)** — Telegram bot framework
- **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** — Local SQLite database
- **[Next.js](https://nextjs.org)** — Admin dashboard
- **[Kokoro](https://github.com/hexgrad/kokoro)** — Local text-to-speech engine

## Claude Code

This project includes a `CLAUDE.md` file that provides full context to [Claude Code](https://claude.ai/claude-code). Open the project in Claude Code and it will understand the architecture, guide you through setup, and help you build new features.

## License

MIT
