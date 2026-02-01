import { Router, Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import { getProjectRoot, parseEnvFile } from "../utils.js";

const router = Router();

const PROJECT_ROOT = getProjectRoot();
const MCP_ROOT = path.resolve(PROJECT_ROOT, "../pHouseMcp");
const MCP_ENV_FILE = path.join(MCP_ROOT, ".env");
const API_ENV_FILE = path.join(PROJECT_ROOT, "api/.env.local");
const GOOGLE_TOKEN_FILE = path.join(MCP_ROOT, "credentials/tokens.json");
const GOOGLE_CREDENTIALS_FILE = path.join(MCP_ROOT, "credentials/client_secret.json");

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

// Start OAuth flow - redirect to Google
router.get("/google/start", async (_req: Request, res: Response) => {
  try {
    // Read env files to get credentials and base URL
    const [mcpEnv, apiEnv] = await Promise.all([
      parseEnvFile(MCP_ENV_FILE),
      parseEnvFile(API_ENV_FILE),
    ]);

    const baseUrl = apiEnv.DASHBOARD_URL || "localhost:3000";
    const authServiceUrl = apiEnv.AUTH_SERVICE_URL;

    // If auth service is configured, redirect there instead
    if (authServiceUrl) {
      const authUrl = `${authServiceUrl}/api/oauth/google/start?origin=${encodeURIComponent(baseUrl)}`;
      res.redirect(authUrl);
      return;
    }

    // Otherwise, do OAuth directly (requires local Google credentials)
    const credentials = await getGoogleCredentials(mcpEnv);

    if (!credentials) {
      res.status(400).json({
        error: "Google credentials not configured. Please set Client ID/Secret in Config or add credentials/client_secret.json"
      });
      return;
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
    res.redirect(authUrl);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// OAuth callback - exchange code for tokens
router.get("/google/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;
  const error = req.query.error as string | undefined;

  // Read env files
  const [mcpEnv, apiEnv] = await Promise.all([
    parseEnvFile(MCP_ENV_FILE),
    parseEnvFile(API_ENV_FILE),
  ]);

  const baseUrl = apiEnv.DASHBOARD_URL || "http://localhost:3000";

  if (error) {
    // User denied or error occurred
    const errorUrl = new URL("/config", baseUrl);
    errorUrl.searchParams.set("oauth_error", error);
    res.redirect(errorUrl.toString());
    return;
  }

  if (!code) {
    const errorUrl = new URL("/config", baseUrl);
    errorUrl.searchParams.set("oauth_error", "No authorization code received");
    res.redirect(errorUrl.toString());
    return;
  }

  const credentials = await getGoogleCredentials(mcpEnv);

  if (!credentials) {
    const errorUrl = new URL("/config", baseUrl);
    errorUrl.searchParams.set("oauth_error", "Google credentials not configured");
    res.redirect(errorUrl.toString());
    return;
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
      res.redirect(errorUrl.toString());
      return;
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
    res.redirect(successUrl.toString());
  } catch (err) {
    console.error("OAuth callback error:", err);
    const errorUrl = new URL("/config", baseUrl);
    errorUrl.searchParams.set("oauth_error", String(err));
    res.redirect(errorUrl.toString());
  }
});

// Receive tokens from auth service
router.get("/google/receive", async (req: Request, res: Response) => {
  const encodedTokens = req.query.tokens as string | undefined;
  const error = req.query.error as string | undefined;

  const apiEnv = await parseEnvFile(API_ENV_FILE);
  const baseUrl = apiEnv.DASHBOARD_URL
    ? `https://${apiEnv.DASHBOARD_URL}`
    : "http://localhost:3000";

  if (error) {
    const errorUrl = new URL("/config", baseUrl);
    errorUrl.searchParams.set("oauth_error", error);
    res.redirect(errorUrl.toString());
    return;
  }

  if (!encodedTokens) {
    const errorUrl = new URL("/config", baseUrl);
    errorUrl.searchParams.set("oauth_error", "No tokens received");
    res.redirect(errorUrl.toString());
    return;
  }

  try {
    // Decode tokens
    const tokens = JSON.parse(
      Buffer.from(encodedTokens, "base64url").toString("utf-8")
    );

    // Ensure credentials directory exists
    const credentialsDir = path.dirname(GOOGLE_TOKEN_FILE);
    await fs.mkdir(credentialsDir, { recursive: true });

    // Save tokens
    await fs.writeFile(
      GOOGLE_TOKEN_FILE,
      JSON.stringify(tokens, null, 2) + "\n",
      "utf-8"
    );

    // Redirect back to config with success
    const successUrl = new URL("/config", baseUrl);
    successUrl.searchParams.set(
      "oauth_success",
      "Google account connected successfully"
    );
    res.redirect(successUrl.toString());
  } catch (err) {
    console.error("Error saving tokens:", err);
    const errorUrl = new URL("/config", baseUrl);
    errorUrl.searchParams.set("oauth_error", String(err));
    res.redirect(errorUrl.toString());
  }
});

export default router;
