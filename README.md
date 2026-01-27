# pHouseClawd

A personal AI assistant framework built on Claude Code. Create your own AI assistant with Telegram, Gmail, image generation, scheduled tasks, and web browsing capabilities.

## What You Get

- **Telegram Bot** - Chat with your assistant from anywhere
- **Gmail Integration** - Read and send emails through your assistant
- **Image Generation** - Generate and edit images using Gemini
- **Scheduled Tasks** - Cron jobs for recurring tasks (daily briefings, reminders, etc.)
- **Web Browsing** - Playwright-powered web automation
- **Persistent Memory** - Your assistant remembers context across sessions

## Important: Dedicated Machine Required

This assistant runs with full system access and needs to operate autonomously. **Run this on its own dedicated computer or VM** - not your personal machine. A cheap VPS, Raspberry Pi, or spare laptop works great.

Why? Your assistant needs to:
- Execute commands without asking for permission every time
- Run background processes 24/7
- Access your email, send messages, browse the web on your behalf

## Prerequisites

- A dedicated machine (VPS, VM, Raspberry Pi, etc.)
- Node.js 22+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/pHouse-Productions/pHouseClawd.git
cd pHouseClawd
```

### 2. Run Claude Code with full access

```bash
claude --dangerously-skip-permissions
```

The `--dangerously-skip-permissions` flag lets Claude operate autonomously without prompting for every action. This is required for the assistant to function properly.

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
│   ├── cron.json          # Scheduled tasks
│   └── email-security.json # Email security settings
├── core/
│   └── src/
│       ├── watcher.ts     # Main event processor
│       └── events.ts      # Event queue system
├── listeners/
│   ├── telegram/          # Telegram message listener daemon
│   └── gmail/             # Gmail inbox watcher daemon
├── dashboard/             # Web UI (Next.js)
├── memory/                # Conversation history (gitignored)
├── notes/                 # Your assistant's notes (gitignored)
└── logs/                  # Application logs (gitignored)
```

## MCP Servers (Tools)

The MCP (Model Context Protocol) servers that give your assistant its capabilities live in a separate repository: **[pHouseMcp](https://github.com/mcarcaso/pHouseMcp)**

This separation keeps the tools modular and shareable. You'll need both repos:

```bash
# Clone both repos side by side
git clone https://github.com/pHouse-Productions/pHouseClawd.git
git clone https://github.com/mcarcaso/pHouseMcp.git
```

### Setting up MCPs

1. **Install pHouseMcp dependencies:**
   ```bash
   cd pHouseMcp
   npm install
   ```

2. **Create credentials directory and .env file:**
   ```bash
   mkdir -p credentials
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Add MCP servers to Claude:**

   Edit `~/.claude.json` to add the servers you want. Example for Telegram:
   ```json
   {
     "mcpServers": {
       "telegram": {
         "type": "stdio",
         "command": "npx",
         "args": ["--prefix", "/path/to/pHouseMcp/servers/telegram", "tsx", "/path/to/pHouseMcp/servers/telegram/src/mcp.ts"]
       }
     }
   }
   ```

   Available servers: `telegram`, `gmail`, `google-docs`, `google-sheets`, `google-drive`, `google-places`, `image-gen`, `yahoo-finance`, `cron`, `memory`

4. **For Google services**, you'll need OAuth credentials:
   - Create a project in Google Cloud Console
   - Enable the APIs (Gmail, Docs, Sheets, Drive)
   - Create OAuth 2.0 credentials (Desktop app)
   - Download as `client_secret.json` to `pHouseMcp/credentials/`
   - Run the auth flow to generate `tokens.json`

## Configuration

All configuration is managed by Claude through JSON files in the `config/` directory. You don't need to edit these manually - just tell Claude what you want and it will update the configs.

**Configuration files (all gitignored, created by Claude during setup):**

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Your assistant's personality, your info, preferences |
| `config/cron.json` | Scheduled tasks and reminders |
| `config/email-security.json` | Trusted email addresses for auto-reply |

**Example commands:**
- "Add john@example.com to my trusted email list"
- "Remind me to check my calendar every morning at 9am"
- "Update my address to 123 Main St"

Claude reads and writes these files directly - no manual editing needed.

## Email Security

When Gmail integration is enabled, your assistant will only auto-reply to emails from addresses you've explicitly trusted. Emails from unknown addresses are forwarded to you on Telegram for review.

To add trusted email addresses, just tell Claude:
> "Trust emails from mywork@company.com"

This prevents your assistant from responding to spam, phishing attempts, or impersonators.

## Customization

Your assistant's personality lives in `CLAUDE.md`. Tell Claude how you want to customize:
- Name and identity
- Communication style (formal, casual, funny, whatever)
- Your personal info and preferences
- Important context about your life/work

See `CLAUDE.example.md` for a template.

## Running Your Assistant

Once set up, just run:

```bash
./start.sh
```

This starts all the background processes:
- Telegram listener daemon
- Gmail inbox watcher
- Event watcher (processes incoming messages)
- Dashboard web server

Press Ctrl+C to stop everything.

## Dashboard

Your assistant comes with a web dashboard at `http://your-server:3000`. Claude will generate a password during setup - it'll tell you what it is.

## Updating

```bash
git pull origin main
```

Your personal files (`CLAUDE.md`, `config/*.json`, `memory/`, `notes/`) are gitignored and won't be affected.

## License

MIT
