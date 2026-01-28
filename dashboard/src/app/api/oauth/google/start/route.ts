import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const PROJECT_ROOT = process.env.PHOUSE_PROJECT_ROOT || path.resolve(process.cwd(), "..");
const MCP_ROOT = path.resolve(PROJECT_ROOT, "../pHouseMcp");
const MCP_ENV_FILE = path.join(MCP_ROOT, ".env");
const DASHBOARD_ENV_FILE = path.join(PROJECT_ROOT, "dashboard/.env.local");
const GOOGLE_CREDENTIALS_FILE = path.join(MCP_ROOT, "credentials/client_secret.json");

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

async function getGoogleCredentials(mcpEnv: Record<string, string>): Promise<{ clientId: string; clientSecret: string } | null> {
  // First try env vars
  if (mcpEnv.GOOGLE_CLIENT_ID && mcpEnv.GOOGLE_CLIENT_SECRET) {
    return { clientId: mcpEnv.GOOGLE_CLIENT_ID, clientSecret: mcpEnv.GOOGLE_CLIENT_SECRET };
  }

  // Then try credentials JSON file
  try {
    const credPath = mcpEnv.GOOGLE_CREDENTIALS_PATH || GOOGLE_CREDENTIALS_FILE;
    const content = await fs.readFile(credPath, "utf-8");
    const creds = JSON.parse(content);
    const installed = creds.installed || creds.web;
    if (installed?.client_id && installed?.client_secret) {
      return { clientId: installed.client_id, clientSecret: installed.client_secret };
    }
  } catch {
    // File doesn't exist or invalid
  }

  return null;
}

// Google OAuth scopes - kitchen sink edition
const SCOPES = [
  // Calendar
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.settings.readonly",

  // Gmail
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/gmail.settings.basic",

  // Drive
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/drive.photos.readonly",

  // Docs
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/documents.readonly",

  // Sheets
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/spreadsheets.readonly",

  // Slides
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/presentations.readonly",

  // Contacts / People
  "https://www.googleapis.com/auth/contacts",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/directory.readonly",

  // Tasks
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/tasks.readonly",

  // YouTube
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.upload",

  // Photos
  "https://www.googleapis.com/auth/photoslibrary",
  "https://www.googleapis.com/auth/photoslibrary.readonly",
  "https://www.googleapis.com/auth/photoslibrary.appendonly",

  // Fitness
  "https://www.googleapis.com/auth/fitness.activity.read",
  "https://www.googleapis.com/auth/fitness.activity.write",
  "https://www.googleapis.com/auth/fitness.body.read",
  "https://www.googleapis.com/auth/fitness.body.write",
  "https://www.googleapis.com/auth/fitness.location.read",
  "https://www.googleapis.com/auth/fitness.nutrition.read",
  "https://www.googleapis.com/auth/fitness.sleep.read",

  // User info
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
];

export async function GET() {
  try {
    // Read env files to get credentials and base URL
    const [mcpEnv, dashboardEnv] = await Promise.all([
      parseEnvFile(MCP_ENV_FILE),
      parseEnvFile(DASHBOARD_ENV_FILE),
    ]);

    const baseUrl = dashboardEnv.DASHBOARD_URL || "localhost:3000";
    const authServiceUrl = dashboardEnv.AUTH_SERVICE_URL;

    // If auth service is configured, redirect there instead
    if (authServiceUrl) {
      const authUrl = `${authServiceUrl}/api/oauth/google/start?origin=${encodeURIComponent(baseUrl)}`;
      return NextResponse.redirect(authUrl);
    }

    // Otherwise, do OAuth directly (requires local Google credentials)
    const credentials = await getGoogleCredentials(mcpEnv);

    if (!credentials) {
      return NextResponse.json(
        { error: "Google credentials not configured. Please set Client ID/Secret in Config or add credentials/client_secret.json" },
        { status: 400 }
      );
    }

    const { clientId } = credentials;
    const fullBaseUrl = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;
    const redirectUri = `${fullBaseUrl}/api/oauth/google/callback`;

    // Build the Google OAuth URL
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent", // Force consent to get refresh token
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    // Redirect to Google
    return NextResponse.redirect(authUrl);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
