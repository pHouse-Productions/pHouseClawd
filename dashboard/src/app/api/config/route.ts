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
const CLAUDE_MD_FILE = path.join(PROJECT_ROOT, "CLAUDE.md");

// Config schema - keys exposed in UI
export const CONFIG_SCHEMA = {
  telegram: {
    TELEGRAM_BOT_TOKEN: {
      label: "Telegram Bot Token",
      description: "Token for your Telegram bot",
      howToGet: `1. Open Telegram and search for @BotFather
2. Send /newbot and follow the prompts to create a bot
3. BotFather will give you a token (looks like: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz)
4. Copy and paste that token here

Note: You'll also need to message your bot once and get your Chat ID. Send any message to your bot, then visit:
https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
Look for "chat":{"id":XXXXXXXX} - that number is your Chat ID.`,
      required: true,
      sensitive: true,
    },
  },
  google: {
    GOOGLE_CLIENT_ID: {
      label: "Google OAuth Client ID",
      description: "Client ID for Google OAuth authentication",
      howToGet: `1. Go to Google Cloud Console (console.cloud.google.com)
2. Create a new project or select an existing one
3. Go to "APIs & Services" > "Credentials"
4. Click "Create Credentials" > "OAuth client ID"
5. Select "Desktop app" as the application type
6. Copy the Client ID`,
      required: true,
      sensitive: false,
    },
    GOOGLE_CLIENT_SECRET: {
      label: "Google OAuth Client Secret",
      description: "Client secret for Google OAuth authentication",
      howToGet: `This is provided alongside the Client ID when you create OAuth credentials in Google Cloud Console.`,
      required: true,
      sensitive: true,
    },
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
    const [envVars, dashboardVars, googleToken, googleCredentials, channelsConfig, emailSecurityConfig, claudeMd] = await Promise.all([
      parseEnvFile(MCP_ENV_FILE),
      parseEnvFile(DASHBOARD_ENV_FILE),
      readJsonFile(GOOGLE_TOKEN_FILE),
      readJsonFile(GOOGLE_CREDENTIALS_FILE),
      readJsonFile(CHANNELS_CONFIG),
      readJsonFile(EMAIL_SECURITY_CONFIG),
      fs.readFile(CLAUDE_MD_FILE, "utf-8").catch(() => ""),
    ]);

    // Extract Google credentials from JSON file if present
    let googleClientId = envVars.GOOGLE_CLIENT_ID || "";
    let googleClientSecret = envVars.GOOGLE_CLIENT_SECRET || "";
    if (googleCredentials && typeof googleCredentials === "object") {
      const creds = googleCredentials as Record<string, unknown>;
      const installed = (creds.installed || creds.web) as Record<string, string> | undefined;
      if (installed) {
        googleClientId = googleClientId || installed.client_id || "";
        googleClientSecret = googleClientSecret || installed.client_secret || "";
      }
    }

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

    // Google vars - use credentials from JSON file as fallback
    const googleVars: Record<string, string> = {};
    for (const [key, schema] of Object.entries(CONFIG_SCHEMA.google)) {
      let value = envVars[key];
      if (key === "GOOGLE_CLIENT_ID") value = googleClientId;
      else if (key === "GOOGLE_CLIENT_SECRET") value = googleClientSecret;
      googleVars[key] = maskValue(value, schema.sensitive);
    }

    const aiVars: Record<string, string> = {};
    for (const [key, schema] of Object.entries(CONFIG_SCHEMA.ai)) {
      aiVars[key] = maskValue(envVars[key], schema.sensitive);
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
      google: googleVars,
      ai: aiVars,
      dashboard: maskedDashboardVars,
      googleToken: {
        status: googleTokenStatus,
        expiry: googleTokenExpiry,
        raw: googleToken ? JSON.stringify(googleToken, null, 2) : "",
      },
      channels: channelsConfig,
      emailSecurity: emailSecurityConfig,
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
        // Google Client ID and Secret go to credentials JSON file
        if (key === "GOOGLE_CLIENT_ID" || key === "GOOGLE_CLIENT_SECRET") {
          let creds = await readJsonFile(GOOGLE_CREDENTIALS_FILE) as Record<string, unknown> | null;
          if (!creds) {
            creds = { installed: { client_id: "", client_secret: "", redirect_uris: ["http://localhost"] } };
          }
          const installed = (creds.installed || creds.web || {}) as Record<string, unknown>;
          if (key === "GOOGLE_CLIENT_ID") {
            installed.client_id = value || "";
          } else {
            installed.client_secret = value || "";
          }
          if (creds.installed) {
            creds.installed = installed;
          } else if (creds.web) {
            creds.web = installed;
          } else {
            creds.installed = installed;
          }
          // Ensure credentials directory exists
          await fs.mkdir(path.dirname(GOOGLE_CREDENTIALS_FILE), { recursive: true });
          await writeJsonFile(GOOGLE_CREDENTIALS_FILE, creds);
          return NextResponse.json({ success: true, message: `Updated ${key}. Restart required.` });
        }

        // Other env vars go to .env file
        const vars = await parseEnvFile(MCP_ENV_FILE);
        if (value === null || value === "") {
          delete vars[key];
        } else {
          vars[key] = value;
        }
        await writeEnvFile(MCP_ENV_FILE, vars);
        return NextResponse.json({ success: true, message: `Updated ${key}. Restart required.` });
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
