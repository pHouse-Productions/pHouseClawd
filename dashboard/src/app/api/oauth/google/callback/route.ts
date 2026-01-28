import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const PROJECT_ROOT = process.env.PHOUSE_PROJECT_ROOT || path.resolve(process.cwd(), "..");
const MCP_ROOT = path.resolve(PROJECT_ROOT, "../pHouseMcp");
const MCP_ENV_FILE = path.join(MCP_ROOT, ".env");
const DASHBOARD_ENV_FILE = path.join(PROJECT_ROOT, "dashboard/.env.local");
const GOOGLE_TOKEN_FILE = path.join(MCP_ROOT, "credentials/tokens.json");
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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  // Read env files
  const [mcpEnv, dashboardEnv] = await Promise.all([
    parseEnvFile(MCP_ENV_FILE),
    parseEnvFile(DASHBOARD_ENV_FILE),
  ]);

  const baseUrl = dashboardEnv.DASHBOARD_URL || "http://localhost:3000";

  if (error) {
    // User denied or error occurred
    const errorUrl = new URL("/config", baseUrl);
    errorUrl.searchParams.set("oauth_error", error);
    return NextResponse.redirect(errorUrl.toString());
  }

  if (!code) {
    const errorUrl = new URL("/config", baseUrl);
    errorUrl.searchParams.set("oauth_error", "No authorization code received");
    return NextResponse.redirect(errorUrl.toString());
  }

  const credentials = await getGoogleCredentials(mcpEnv);

  if (!credentials) {
    const errorUrl = new URL("/config", baseUrl);
    errorUrl.searchParams.set("oauth_error", "Google credentials not configured");
    return NextResponse.redirect(errorUrl.toString());
  }

  const { clientId, clientSecret } = credentials;
  const redirectUri = `${baseUrl}/api/oauth/google/callback`;

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error("Token exchange failed:", errorData);
      const errorUrl = new URL("/config", baseUrl);
      errorUrl.searchParams.set("oauth_error", "Token exchange failed");
      return NextResponse.redirect(errorUrl.toString());
    }

    const tokens = await tokenResponse.json();

    // Add expiry_date for easier checking
    if (tokens.expires_in) {
      tokens.expiry_date = Date.now() + tokens.expires_in * 1000;
    }

    // Ensure credentials directory exists
    const credentialsDir = path.dirname(GOOGLE_TOKEN_FILE);
    await fs.mkdir(credentialsDir, { recursive: true });

    // Save tokens
    await fs.writeFile(GOOGLE_TOKEN_FILE, JSON.stringify(tokens, null, 2) + "\n", "utf-8");

    // Redirect back to config with success
    const successUrl = new URL("/config", baseUrl);
    successUrl.searchParams.set("oauth_success", "Google account connected successfully");
    return NextResponse.redirect(successUrl.toString());
  } catch (err) {
    console.error("OAuth callback error:", err);
    const errorUrl = new URL("/config", baseUrl);
    errorUrl.searchParams.set("oauth_error", String(err));
    return NextResponse.redirect(errorUrl.toString());
  }
}
