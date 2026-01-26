# pHouseClawd

A personal AI assistant framework built on Claude Code. Create your own AI assistant with Telegram, Gmail, image generation, scheduled tasks, and web browsing capabilities.

## What You Get

- **Telegram Bot** - Chat with your assistant from anywhere
- **Gmail Integration** - Read and send emails through your assistant
- **Image Generation** - Generate and edit images using Gemini
- **Scheduled Tasks** - Cron jobs for recurring tasks (daily briefings, reminders, etc.)
- **Web Browsing** - Playwright-powered web automation
- **Persistent Memory** - Your assistant remembers context across sessions

## Prerequisites

- Node.js 22+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/pHouse-Productions/pHouseClawd.git
cd pHouseClawd
```

### 2. Run Claude Code

```bash
claude
```

### 3. Tell Claude what you want

Just describe what you're trying to do:

> "Hey, I want to set up a personal assistant. My name is [name], my email is [email]. I want to use Telegram and Gmail."

Claude will:
- Walk you through getting API keys and credentials
- Install dependencies
- Create your personalized `CLAUDE.md` configuration
- Set up MCP servers for your integrations
- Create necessary directories
- Get everything running

## What Claude Will Help You Set Up

**Telegram Bot:**
- Create a bot via @BotFather
- Configure your bot token and chat ID
- Start the Telegram daemon

**Gmail (optional):**
- Set up Google Cloud OAuth credentials
- Run the authentication flow
- Configure the Gmail MCP server

**Image Generation (optional):**
- Get an OpenRouter API key
- Configure the image generation MCP server

**Scheduled Tasks:**
- Set up cron jobs for recurring tasks
- Morning briefings, reminders, whatever you want

## Project Structure

```
pHouseClawd/
├── CLAUDE.md              # Your assistant's personality and instructions
├── config/
│   └── cron.json          # Scheduled tasks configuration
├── core/
│   └── src/
│       ├── watcher.ts     # Main event processor
│       └── events.ts      # Event queue system
├── integrations/
│   ├── telegram/          # Telegram bot integration
│   ├── gmail/             # Gmail integration
│   ├── image-gen/         # Image generation (Gemini)
│   └── cron/              # Cron job management
├── memory/                # Conversation history (gitignored)
├── notes/                 # Your assistant's notes (gitignored)
└── logs/                  # Application logs (gitignored)
```

## Customization

Your assistant's personality lives in `CLAUDE.md`. Edit it to customize:
- Name and identity
- Communication style (formal, casual, funny, whatever)
- Your personal info and preferences
- Important context about your life/work

See `CLAUDE.example.md` for a template.

## Running Your Assistant

Once set up, you'll run two processes:

**Terminal 1 - The Watcher** (processes incoming messages and tasks):
```bash
cd core && npx tsx src/watcher.ts
```

**Terminal 2 - Telegram Daemon** (receives Telegram messages):
```bash
cd integrations/telegram && npx tsx src/daemon.ts
```

## Updating

```bash
git pull origin main
```

Your personal files (`CLAUDE.md`, `.env` files, `memory/`, `notes/`) are gitignored and won't be affected.

## License

MIT
