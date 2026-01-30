import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const PROJECT_ROOT = process.env.PHOUSE_PROJECT_ROOT || path.resolve(process.cwd(), "..");
const MCP_ROOT = path.resolve(PROJECT_ROOT, "../pHouseMcp");
const MCP_ENV_FILE = path.join(MCP_ROOT, ".env");
const GOOGLE_TOKEN_FILE = path.join(MCP_ROOT, "credentials/tokens.json");
const GOOGLE_CREDENTIALS_FILE = path.join(MCP_ROOT, "credentials/client_secret.json");
const DASHBOARD_ENV_FILE = path.join(PROJECT_ROOT, "dashboard/.env.local");
const CHANNELS_CONFIG = path.join(PROJECT_ROOT, "config/channels.json");
const EMAIL_SECURITY_CONFIG = path.join(PROJECT_ROOT, "config/email-security.json");
const GCHAT_SECURITY_CONFIG = path.join(PROJECT_ROOT, "config/gchat-security.json");
const DISCORD_SECURITY_CONFIG = path.join(PROJECT_ROOT, "config/discord-security.json");
const CLAUDE_MD_FILE = path.join(PROJECT_ROOT, "CLAUDE.md");

// Config schema - keys exposed in UI
export const CONFIG_SCHEMA = {
  telegram: {
    TELEGRAM_BOT_TOKEN: {
      label: "Bot Token",
      description: "Token for your Telegram bot",
      howToGet: `1. Open Telegram and search for @BotFather
2. Send /newbot and follow the prompts to create a bot
3. BotFather will give you a token (looks like: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz)
4. Copy and paste that token here

Note: You'll also need to message your bot once and get your Chat ID. Send any message to your bot, then visit:
https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
Look for "chat":{"id":XXXXXXXX} - that number is your Chat ID.`,
      required: false,
      sensitive: true,
    },
  },
  discord: {
    DISCORD_BOT_TOKEN: {
      label: "Bot Token",
      description: "Token for your Discord bot",
      howToGet: `1. Go to discord.com/developers/applications
2. Click "New Application" and give it a name
3. Go to "Bot" in the left sidebar
4. Click "Reset Token" to get your bot token
5. Enable "Message Content Intent" under Privileged Gateway Intents
6. Go to "OAuth2" > "URL Generator", select "bot" scope
7. Select permissions: Send Messages, Read Message History, Add Reactions
8. Use the generated URL to invite the bot to your server`,
      required: false,
      sensitive: true,
    },
  },
  google: {
    GOOGLE_PLACES_API_KEY: {
      label: "Google Places API Key",
      description: "API key for Google Places (business search, reviews, etc.)",
      howToGet: `1. Go to Google Cloud Console (console.cloud.google.com)
2. Go to "APIs & Services" > "Credentials"
3. Click "Create Credentials" > "API Key"
4. Optionally restrict the key to Places API only
5. Copy the API key

Note: You'll need to enable the "Places API" in your project.`,
      required: false,
      sensitive: true,
    },
  },
  googleCredentials: {
    label: "Google OAuth Credentials",
    description: "OAuth client credentials for Google APIs (Gmail, Calendar, Drive, etc.)",
    howToGet: `1. Go to Google Cloud Console (console.cloud.google.com)
2. Create a new project or select an existing one
3. Go to "APIs & Services" > "Credentials"
4. Click "Create Credentials" > "OAuth client ID"
5. Select "Desktop app" as the application type
6. Click "Download JSON" to get your credentials file
7. Paste the entire JSON contents here`,
  },
  ai: {
    OPENROUTER_API_KEY: {
      label: "OpenRouter API Key",
      description: "API key for OpenRouter (image generation, etc.)",
      howToGet: `1. Go to openrouter.ai and create an account
2. Go to "Keys" in your dashboard
3. Create a new API key
4. Copy the key (starts with sk-or-)`,
      required: false,
      sensitive: true,
    },
  },
  dashboard: {
    DASHBOARD_PASSWORD: {
      label: "Dashboard Password",
      description: "Password to access this dashboard",
      howToGet: "Choose a secure password. This protects access to your dashboard.",
      required: true,
      sensitive: true,
    },
    DASHBOARD_URL: {
      label: "Dashboard URL",
      description: "Public URL of this dashboard (for OAuth redirects)",
      howToGet: "The base URL where this dashboard is accessible. Examples:\n- http://localhost:3000 (local development)\n- https://dashboard.yourdomain.com (production)\n\nThis is used for OAuth callback URLs.",
      required: false,
      sensitive: false,
    },
  },
  googleToken: {
    label: "Google OAuth Token",
    description: "Your Google account authorization (for Calendar, Gmail, Docs, etc.)",
    howToGet: `This token is generated when you authorize the app to access your Google account.

If you need to generate a new token:
1. Ask the assistant to run the Google OAuth flow
2. Follow the link to authorize
3. The token will be saved automatically

Or if you have an existing token JSON, paste it here.`,
  },
};

async function parseEnvFile(filePath: string): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const vars: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const key = trimmed.slice(0, eqIndex);
          const value = trimmed.slice(eqIndex + 1);
          vars[key] = value;
        }
      }
    }
    return vars;
  } catch {
    return {};
  }
}

async function writeEnvFile(filePath: string, vars: Record<string, string>): Promise<void> {
  const lines = Object.entries(vars).map(([key, value]) => `${key}=${value}`);
  await fs.writeFile(filePath, lines.join("\n") + "\n", "utf-8");
}

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export async function GET() {
  try {
    // Read all config sources
    const [envVars, dashboardVars, googleToken, googleCredentials, channelsConfig, emailSecurityConfig, gchatSecurityConfig, discordSecurityConfig, claudeMd] = await Promise.all([
      parseEnvFile(MCP_ENV_FILE),
      parseEnvFile(DASHBOARD_ENV_FILE),
      readJsonFile(GOOGLE_TOKEN_FILE),
      readJsonFile(GOOGLE_CREDENTIALS_FILE),
      readJsonFile(CHANNELS_CONFIG),
      readJsonFile(EMAIL_SECURITY_CONFIG),
      readJsonFile(GCHAT_SECURITY_CONFIG),
      readJsonFile(DISCORD_SECURITY_CONFIG),
      fs.readFile(CLAUDE_MD_FILE, "utf-8").catch(() => ""),
    ]);

    // Helper to mask sensitive values
    const maskValue = (value: string | undefined, sensitive: boolean): string => {
      if (!value) return "";
      if (!sensitive) return value;
      if (value.length <= 12) return "••••••••";
      return value.slice(0, 8) + "..." + value.slice(-4);
    };

    // Process env vars by category
    const telegramVars: Record<string, string> = {};
    for (const [key, schema] of Object.entries(CONFIG_SCHEMA.telegram)) {
      telegramVars[key] = maskValue(envVars[key], schema.sensitive);
    }

    // Discord env vars
    const discordVars: Record<string, string> = {};
    for (const [key, schema] of Object.entries(CONFIG_SCHEMA.discord)) {
      discordVars[key] = maskValue(envVars[key], schema.sensitive);
    }

    // Google env vars (just Places API key now)
    const googleVars: Record<string, string> = {};
    for (const [key, schema] of Object.entries(CONFIG_SCHEMA.google)) {
      googleVars[key] = maskValue(envVars[key], schema.sensitive);
    }

    const aiVars: Record<string, string> = {};
    for (const [key, schema] of Object.entries(CONFIG_SCHEMA.ai)) {
      aiVars[key] = maskValue(envVars[key], schema.sensitive);
    }

    // Check if Google credentials file exists and has required fields
    let googleCredentialsStatus = "not_configured";
    if (googleCredentials && typeof googleCredentials === "object") {
      const creds = googleCredentials as Record<string, unknown>;
      const installed = (creds.installed || creds.web) as Record<string, string> | undefined;
      if (installed?.client_id && installed?.client_secret) {
        googleCredentialsStatus = "configured";
      }
    }

    // Process dashboard vars (mask sensitive ones)
    const maskedDashboardVars: Record<string, string> = {};
    for (const [key, schema] of Object.entries(CONFIG_SCHEMA.dashboard)) {
      const value = dashboardVars[key];
      if (schema.sensitive) {
        maskedDashboardVars[key] = value ? "••••••••" : "";
      } else {
        maskedDashboardVars[key] = value || "";
      }
    }

    // Check if Google token exists and is valid
    let googleTokenStatus = "not_configured";
    let googleTokenExpiry = "";
    if (googleToken && typeof googleToken === "object") {
      const token = googleToken as Record<string, unknown>;
      if (token.access_token) {
        googleTokenStatus = "configured";
        if (token.expiry_date) {
          const expiry = new Date(token.expiry_date as number);
          googleTokenExpiry = expiry.toISOString();
          if (expiry < new Date()) {
            googleTokenStatus = "expired";
          }
        }
      }
    }

    return NextResponse.json({
      schema: CONFIG_SCHEMA,
      telegram: telegramVars,
      discord: discordVars,
      google: googleVars,
      ai: aiVars,
      dashboard: maskedDashboardVars,
      googleCredentials: {
        status: googleCredentialsStatus,
        raw: googleCredentials ? JSON.stringify(googleCredentials, null, 2) : "",
      },
      googleToken: {
        status: googleTokenStatus,
        expiry: googleTokenExpiry,
        raw: googleToken ? JSON.stringify(googleToken, null, 2) : "",
      },
      channels: channelsConfig || {
        channels: {
          telegram: { enabled: false },
          email: { enabled: false },
          gchat: { enabled: false },
        },
      },
      emailSecurity: emailSecurityConfig,
      gchatSecurity: gchatSecurityConfig || { allowedSpaces: [], myUserId: "" },
      discordSecurity: discordSecurityConfig || { allowedChannels: [], allowedGuilds: [], myUserId: null, userNames: {} },
      claudeMd: claudeMd,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, key, value, data } = body;

    switch (type) {
      case "env": {
        const vars = await parseEnvFile(MCP_ENV_FILE);
        if (value === null || value === "") {
          delete vars[key];
        } else {
          vars[key] = value;
        }
        await writeEnvFile(MCP_ENV_FILE, vars);
        return NextResponse.json({ success: true, message: `Updated ${key}. Restart required.` });
      }

      case "googleCredentials": {
        if (!data || data.trim() === "") {
          // Delete credentials file
          try {
            await fs.unlink(GOOGLE_CREDENTIALS_FILE);
          } catch {
            // File might not exist
          }
          return NextResponse.json({ success: true, message: "Google credentials removed." });
        }
        // Validate JSON and required fields
        try {
          const parsed = JSON.parse(data);
          const installed = parsed.installed || parsed.web;
          if (!installed?.client_id || !installed?.client_secret) {
            return NextResponse.json({ error: "JSON must contain client_id and client_secret" }, { status: 400 });
          }
          // Ensure credentials directory exists
          await fs.mkdir(path.dirname(GOOGLE_CREDENTIALS_FILE), { recursive: true });
          await writeJsonFile(GOOGLE_CREDENTIALS_FILE, parsed);
          return NextResponse.json({ success: true, message: "Google credentials updated. Restart required." });
        } catch {
          return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
        }
      }

      case "dashboard": {
        const vars = await parseEnvFile(DASHBOARD_ENV_FILE);
        if (value === null || value === "") {
          delete vars[key];
        } else {
          vars[key] = value;
        }
        await writeEnvFile(DASHBOARD_ENV_FILE, vars);
        return NextResponse.json({ success: true, message: `Updated ${key}. Restart required.` });
      }

      case "googleToken": {
        if (!data || data.trim() === "") {
          // Delete token file
          try {
            await fs.unlink(GOOGLE_TOKEN_FILE);
          } catch {
            // File might not exist
          }
          return NextResponse.json({ success: true, message: "Google token removed." });
        }
        // Validate JSON
        try {
          const parsed = JSON.parse(data);
          await writeJsonFile(GOOGLE_TOKEN_FILE, parsed);
          return NextResponse.json({ success: true, message: "Google token updated. Restart required." });
        } catch {
          return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
        }
      }

      case "channels": {
        await writeJsonFile(CHANNELS_CONFIG, data);
        return NextResponse.json({ success: true, message: "Channels config updated. Restart required." });
      }

      case "emailSecurity": {
        await writeJsonFile(EMAIL_SECURITY_CONFIG, data);
        return NextResponse.json({ success: true, message: "Email security config updated." });
      }

      case "gchatSecurity": {
        await writeJsonFile(GCHAT_SECURITY_CONFIG, data);
        return NextResponse.json({ success: true, message: "Google Chat config updated. Restart required." });
      }

      case "discordSecurity": {
        await writeJsonFile(DISCORD_SECURITY_CONFIG, data);
        return NextResponse.json({ success: true, message: "Discord config updated. Restart required." });
      }

      case "claudeMd": {
        await fs.writeFile(CLAUDE_MD_FILE, data, "utf-8");
        return NextResponse.json({ success: true, message: "CLAUDE.md updated." });
      }

      default:
        return NextResponse.json({ error: "Unknown config type" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
