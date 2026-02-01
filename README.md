# pHouseClawd

A personal AI assistant framework built on Claude Code. Create your own AI assistant with Telegram, Gmail, image generation, scheduled tasks, and web browsing capabilities.

## What You Get

- **Telegram Bot** - Chat with your assistant from anywhere
- **Gmail Integration** - Read and send emails through your assistant
- **Google Chat Integration** - Chat via Google Chat (requires setup)
- **Discord Bot** - Chat via Discord server
- **Image Generation** - Generate and edit images using Gemini
- **Scheduled Tasks** - Cron jobs for recurring tasks (daily briefings, reminders, etc.)
- **Web Browsing** - Playwright-powered web automation
- **Persistent Memory** - Your assistant remembers context across sessions
- **Stock Data** - Real-time quotes and company news via Finnhub

## Important: Dedicated Machine Required

This assistant runs with full system access and needs to operate autonomously. **Run this on its own dedicated computer or VM** - not your personal machine. A cheap VPS, Raspberry Pi, or spare laptop works great.

Why? Your assistant needs to:
- Execute commands without asking for permission every time
- Run background processes 24/7
- Access your email, send messages, browse the web on your behalf

## Prerequisites

- A dedicated machine (VPS, VM, Raspberry Pi, etc.)
- Node.js 22+

## Quick Start

### 1. Clone the repositories

```bash
# Clone both repos side by side
git clone https://github.com/pHouse-Productions/pHouseClawd.git
git clone https://github.com/pHouse-Productions/pHouseMcp.git
```

### 2. Install and authenticate Claude Code

Install Claude Code CLI following the [official docs](https://docs.anthropic.com/en/docs/claude-code).

```bash
# Install Claude Code
npm install -g @anthropic-ai/claude-code

# Authenticate with your Anthropic account
claude
```

Follow the prompts to log in. This is a one-time setup that stores your credentials locally.

### 3. Authenticate GitHub CLI

The assistant uses GitHub for version control and deployments. Install and authenticate the GitHub CLI:

```bash
# Install GitHub CLI (if not already installed)
# On Ubuntu/Debian:
sudo apt install gh

# Authenticate
gh auth login
```

Follow the prompts to log in with your GitHub account.

### 4. Start the assistant

```bash
cd pHouseClawd
claude --dangerously-skip-permissions
```

The `--dangerously-skip-permissions` flag lets Claude operate autonomously without prompting for every action. This is required for the assistant to function properly.

### 5. Tell Claude what you want

Just describe what you're trying to do:

> "Hey, I want to set up a personal assistant. My name is [name], my email is [email]. I want to use Telegram and Gmail."

Claude will:
- Walk you through the initial setup
- Install dependencies
- Create your personalized `CLAUDE.md` configuration
- Set up MCP servers for your integrations
- Get everything running

### 6. Configure via Dashboard

Once running, access the dashboard at `http://localhost:3000` (or your server's IP).

All remaining configuration is done through the dashboard:
- **Telegram** - Bot token
- **Google APIs** - OAuth credentials, Places API key
- **Google Account** - One-click OAuth connection for Gmail, Calendar, Drive, etc.
- **AI Services** - OpenRouter API key for image generation
- **Channels** - Enable/disable Telegram, Gmail, Google Chat
- **Email Security** - Trusted email addresses
- **Assistant Identity** - Edit CLAUDE.md directly

## What Claude Will Help You Set Up

During initial setup, Claude will walk you through:

1. **Creating a Telegram bot** via @BotFather
2. **Setting up Google Cloud** project and OAuth credentials
3. **Installing dependencies** for pHouseClawd and pHouseMcp
4. **Creating your CLAUDE.md** with your personal info and preferences
5. **Starting the assistant** with all daemons running

After initial setup, use the **dashboard** to:
- Enter API keys and tokens
- Connect your Google account (one-click OAuth)
- Configure channels and security settings
- Manage scheduled tasks

## Project Structure

```
pHouseClawd/
├── CLAUDE.md              # Your assistant's personality and instructions
├── config/
│   ├── channels.json      # Enabled/disabled channels
│   ├── cron.json          # Scheduled tasks
│   ├── email-security.json # Email security settings
│   ├── gchat-security.json # Google Chat security settings
│   └── discord-security.json # Discord security settings
├── core/
│   └── src/
│       ├── watcher.ts     # Main event processor
│       ├── events.ts      # Event queue system
│       └── channels/      # Channel handlers (telegram, email, gchat, discord)
├── listeners/
│   ├── telegram/          # Telegram message listener daemon
│   ├── gmail/             # Gmail inbox watcher daemon
│   ├── gchat/             # Google Chat listener
│   └── discord/           # Discord bot listener
├── api/                   # Express API server (port 3100)
├── dashboard/             # Web UI (Vite + React, static files)
├── memory/
│   ├── short-term/        # Global conversation buffer (auto-logged, gitignored)
│   ├── long-term/         # Persistent memories (gitignored)
│   ├── telegram/          # Telegram-specific context
│   ├── discord/           # Discord-specific context
│   ├── email/             # Email-specific context
│   └── gchat/             # GChat-specific context
├── leads/                 # Business leads tracker (gitignored)
├── websites/              # Generated client websites
└── logs/                  # Application logs (gitignored)
```

## MCP Servers (Tools)

The MCP (Model Context Protocol) servers that give your assistant its capabilities live in a separate repository: **[pHouseMcp](https://github.com/pHouse-Productions/pHouseMcp)**

This separation keeps the tools modular and shareable. You'll need both repos:

```bash
# Clone both repos side by side
git clone https://github.com/pHouse-Productions/pHouseClawd.git
git clone https://github.com/pHouse-Productions/pHouseMcp.git
```

### Setting up MCPs

1. **Install pHouseMcp dependencies:**
   ```bash
   cd pHouseMcp
   npm install
   ```

2. **Build the servers (compile TypeScript to JavaScript):**
   ```bash
   npm run build
   ```

   **Important:** This step is required! The servers run from compiled JavaScript for faster startup times. See the [pHouseMcp README](https://github.com/pHouse-Productions/pHouseMcp) for more details.

3. **Create credentials directory and .env file:**
   ```bash
   mkdir -p credentials
   cp .env.example .env
   # Edit .env with your API keys
   ```

4. **Add MCP servers to Claude:**

   Edit `~/.claude.json` to add the servers you want. Example for Telegram:
   ```json
   {
     "mcpServers": {
       "telegram": {
         "type": "stdio",
         "command": "node",
         "args": ["/path/to/pHouseMcp/servers/telegram/dist/mcp.js"],
         "env": {
           "TELEGRAM_BOT_TOKEN": "your_token"
         }
       }
     }
   }
   ```

   **Note:** We use `node dist/mcp.js` (compiled JavaScript) instead of `npx tsx src/mcp.ts` for faster MCP startup times.

   Available servers: `telegram`, `gmail`, `google-docs`, `google-sheets`, `google-drive`, `google-places`, `google-calendar`, `google-chat`, `discord`, `image-gen`, `finnhub`, `cron`, `memory`, `pdf`

### Recommended Third-Party MCP

For web browsing and automation, we recommend the **Playwright MCP**:

```json
{
  "mcpServers": {
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "args": ["@playwright/mcp", "--headless"]
    }
  }
}
```

This gives your assistant the ability to browse websites, take screenshots, fill forms, and automate web tasks. It's well-maintained and works great out of the box.

4. **For Google services**, you'll need OAuth credentials:
   - Create a project in [Google Cloud Console](https://console.cloud.google.com)
   - Enable the APIs you want (Gmail, Calendar, Docs, Sheets, Drive, etc.)
   - Create OAuth 2.0 credentials (Desktop app type)
   - Download as `client_secret.json` to `pHouseMcp/credentials/`
   - Add `http://localhost:3000/api/oauth/google/callback` as an authorized redirect URI
   - Use the dashboard's "Connect Google Account" button to complete the OAuth flow

## Configuration

Configuration is managed through the **web dashboard** at `http://localhost:3000`. The dashboard lets you:

- Set API keys (Telegram, Google, OpenRouter)
- Connect your Google account via OAuth
- Enable/disable channels (Telegram, Gmail, Google Chat)
- Manage trusted email addresses
- Edit your assistant's personality (CLAUDE.md)
- View and manage scheduled tasks

You can also tell Claude directly what you want:
- "Add john@example.com to my trusted email list"
- "Remind me to check my calendar every morning at 9am"
- "Update my address to 123 Main St"

**Configuration files (all gitignored):**

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Your assistant's personality, your info, preferences |
| `config/cron.json` | Scheduled tasks and reminders |
| `config/channels.json` | Enabled communication channels |
| `config/email-security.json` | Trusted email addresses for auto-reply |
| `config/gchat-security.json` | Whitelisted Google Chat spaces |
| `dashboard/.env.local` | Dashboard password and URL |

## Email Security

When Gmail integration is enabled, your assistant will only auto-reply to emails from addresses you've explicitly trusted. Emails from unknown addresses are forwarded to you on Telegram for review.

To add trusted email addresses, just tell Claude:
> "Trust emails from mywork@company.com"

This prevents your assistant from responding to spam, phishing attempts, or impersonators.

## Google Chat Setup

Google Chat integration requires more setup than other channels. Here's the complete process:

### Prerequisites
- Google Cloud project (same one used for Gmail/Docs/etc)
- OAuth credentials with Chat scopes
- Google Chat enabled on your Google account

### Step 1: Enable Google Chat on Your Account

1. Go to [Gmail Settings](https://mail.google.com/mail/u/0/#settings/chat)
2. Under "Chat and Meet" tab, set Google Chat to **On**
3. Or visit [chat.google.com](https://chat.google.com) and accept the terms

### Step 2: Enable the Google Chat API

1. Go to [Google Cloud Console - Chat API](https://console.cloud.google.com/apis/library/chat.googleapis.com)
2. Select your project
3. Click **Enable**

### Step 3: Configure a Chat App (Required)

Even though we're using user authentication, Google requires a Chat app to be configured:

1. Go to [Chat API Configuration](https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat)
2. Fill in the required fields:
   - **App name**: e.g., "My Assistant"
   - **Avatar URL**: (optional)
   - **Description**: e.g., "Personal AI assistant"
3. Under **Functionality**, you can leave defaults (we don't use webhooks/triggers)
4. Under **Visibility**, select your preference
5. Click **Save**

### Step 4: Add Chat Scopes to OAuth

Your OAuth token needs these scopes:
- `https://www.googleapis.com/auth/chat.spaces`
- `https://www.googleapis.com/auth/chat.messages`
- `https://www.googleapis.com/auth/chat.memberships`

If you already have a `tokens.json`, you may need to re-run the OAuth flow to add these scopes.

### Step 5: Start a Conversation and Accept the Chat

1. Go to [chat.google.com](https://chat.google.com)
2. Start a DM with your assistant's Google account
3. Send a message
4. **Important**: Log into your assistant's Google account and **accept the chat invite** - the assistant cannot respond until the chat is accepted on both sides

### Step 6: Get Your Space ID

Run the test script to find your space ID:

```bash
cd listeners/gchat
npx tsx test-api.ts
```

This will list all spaces and their IDs (format: `spaces/XXXXXXXXX`).

### Step 7: Find Your Bot's User ID

Run the member listing script to find your bot's user ID:

```bash
cd listeners/gchat
npx tsx list-members.ts spaces/XXXXXXXXX
```

This shows all members with their user IDs. The bot account is the one that joined after you initiated the chat.

### Step 8: Configure Security Settings

Add the space ID and your bot's user ID to `config/gchat-security.json`:

```json
{
  "allowedSpaces": ["spaces/XXXXXXXXX"],
  "myUserId": "users/YYYYYYYYY"
}
```

The `myUserId` field prevents the bot from responding to its own messages (which would cause an infinite loop).

### Step 9: Restart the Watcher

```bash
./restart.sh
```

Your assistant will now respond to messages in the whitelisted Google Chat space.

### Troubleshooting

**"Google Chat is turned off"**
- Enable Google Chat in your Gmail settings or visit chat.google.com

**"Google Chat app not found"**
- You need to configure a Chat app in the Cloud Console (Step 3)

**"Permission denied" when sending messages**
- Make sure the chat has been accepted on both sides
- Verify you have the `chat.messages` scope in your OAuth token

**Empty spaces list**
- Google Chat only shows spaces after the first message is sent
- Send a message first, then run the test script

**Bot responds to itself (infinite loop)**
- Make sure `myUserId` is set in `config/gchat-security.json`
- Run `npx tsx list-members.ts` to find the correct user ID

## Customization

Your assistant's personality lives in `CLAUDE.md`. The install script creates this as a seed file, and your assistant will run through an onboarding conversation to fill it in:
- Pick a name together
- Communication style (formal, casual, funny, whatever)
- Your personal info and preferences
- Important context about your life/work

The assistant updates `CLAUDE.md` itself as it learns about you.

## Running Your Assistant

Once set up, just run:

```bash
./start.sh
```

This starts all the background processes:
- Telegram listener daemon
- Gmail inbox watcher
- Google Chat listener (if configured)
- Event watcher (processes incoming messages)
- Dashboard web server

Press Ctrl+C to stop everything.

## Dashboard

Your assistant comes with a web dashboard at `http://localhost:3000` (or your server's IP on port 3000).

**Features:**
- **Home** - System status and quick actions
- **Jobs** - View running and completed tasks
- **Channels** - Monitor active communication channels
- **Cron** - Manage scheduled tasks
- **Memory** - View short-term and long-term memory
- **MCP** - View available MCP servers and tools
- **Logs** - Application logs for debugging
- **Skills** - Available slash commands
- **Config** - All API keys, OAuth, and settings

Claude will generate a dashboard password during setup. You can change it anytime in the Config page.

## Updating

**pHouseClawd:**
```bash
cd pHouseClawd
git pull origin main
cd core && npm install && cd ..  # Install any new dependencies
```

**pHouseMcp:**
```bash
cd pHouseMcp
git pull origin main
npm install    # Install any new dependencies
npm run build  # Rebuild after pulling updates!
```

Your personal files (`CLAUDE.md`, `config/*.json`, `memory/`, `leads/`) are gitignored and won't be affected.

## License

MIT
