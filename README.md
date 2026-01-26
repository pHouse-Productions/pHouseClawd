# pHouseClawd

A personal AI assistant framework built on Claude Code. Create your own AI assistant with Telegram, Gmail, image generation, scheduled tasks, and web browsing capabilities.

## Features

- **Telegram Integration** - Bidirectional messaging with your assistant, including photo support
- **Gmail Integration** - Read and send emails through your assistant
- **Image Generation** - Generate and edit images using Gemini (via OpenRouter)
- **Scheduled Tasks** - Set up cron jobs for recurring tasks
- **Web Browsing** - Playwright-powered web automation
- **Persistent Memory** - Conversation history across sessions

## Prerequisites

- Node.js 22+
- [Claude Code CLI](https://github.com/anthropics/claude-code) installed and authenticated
- API keys for the services you want to use

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/vitobot87/pHouseClawd.git
cd pHouseClawd
```

### 2. Install dependencies

```bash
# Core
cd core && npm install && cd ..

# Integrations
cd integrations/telegram && npm install && cd ../..
cd integrations/gmail && npm install && cd ../..
cd integrations/image-gen && npm install && cd ../..
cd integrations/cron && npm install && cd ../..
```

### 3. Configure your assistant

Copy the example files and customize them:

```bash
# Assistant personality and instructions
cp CLAUDE.example.md CLAUDE.md

# Telegram
cp integrations/telegram/.env.example integrations/telegram/.env

# Image generation
cp integrations/image-gen/.env.example integrations/image-gen/.env

# Cron jobs
cp config/cron.example.json config/cron.json
```

### 4. Set up Telegram

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Create a new bot with `/newbot`
3. Copy the bot token to `integrations/telegram/.env`
4. Message your bot to get your chat ID (or use [@userinfobot](https://t.me/userinfobot))
5. Add your chat ID to `CLAUDE.md`

### 5. Set up Gmail (optional)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable the Gmail API
4. Create OAuth 2.0 credentials (Desktop app)
5. Download the credentials and save as `integrations/gmail/client_secret.json`
6. Run the auth flow: `cd integrations/gmail && npx tsx src/auth.ts`

### 6. Set up Image Generation (optional)

1. Get an API key from [OpenRouter](https://openrouter.ai/keys)
2. Add it to `integrations/image-gen/.env`

### 7. Register MCP servers

```bash
# Telegram
claude mcp add telegram -s user -- npx tsx /path/to/pHouseClawd/integrations/telegram/src/mcp.ts

# Gmail
claude mcp add gmail -s user -- npx tsx /path/to/pHouseClawd/integrations/gmail/src/mcp.ts

# Image generation
claude mcp add image-gen -s user -- npx --prefix /path/to/pHouseClawd/integrations/image-gen tsx /path/to/pHouseClawd/integrations/image-gen/src/mcp.ts

# Cron jobs
claude mcp add cron -s user -- npx --prefix /path/to/pHouseClawd/integrations/cron tsx /path/to/pHouseClawd/integrations/cron/src/mcp.ts

# Playwright (web browsing)
claude mcp add playwright -s user -- npx @playwright/mcp --headless
```

### 8. Create required directories

```bash
mkdir -p memory/telegram/images
mkdir -p logs
mkdir -p events/pending events/processed
mkdir -p generated_images
```

### 9. Start the watcher

The watcher monitors for incoming messages and scheduled tasks:

```bash
cd core && npx tsx src/watcher.ts
```

### 10. Start the Telegram daemon

In a separate terminal:

```bash
cd integrations/telegram && npx tsx src/daemon.ts
```

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
├── logs/                  # Application logs (gitignored)
└── generated_images/      # Generated images (gitignored)
```

## Customization

### Personality

Edit `CLAUDE.md` to customize your assistant's:
- Name and identity
- Communication style
- Your personal information
- Any important context

### Scheduled Tasks

Use the cron MCP tools or edit `config/cron.json` directly:

```json
{
  "jobs": [
    {
      "id": "morning-briefing",
      "enabled": true,
      "schedule": "daily at 9am",
      "description": "Morning email summary",
      "prompt": "Check my emails and send me a summary on Telegram."
    }
  ]
}
```

Schedule formats:
- Human-readable: `every hour`, `every 30 minutes`, `daily at 9am`, `weekly`
- Cron syntax: `0 9 * * *` (9am daily), `*/30 * * * *` (every 30 min)

## Updating

To pull updates without losing your personal configuration:

```bash
git pull origin main
```

Your personal files (CLAUDE.md, .env files, memory/, logs/) are gitignored and won't be affected.

## License

MIT
