import { google } from "googleapis";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = path.join(__dirname, "../client_secret.json");
const TOKEN_PATH = path.join(__dirname, "../tokens.json");

const SCOPES = [
  // Gmail - full access
  "https://mail.google.com/",
  // Google Drive - full access
  "https://www.googleapis.com/auth/drive",
  // Google Calendar - full access
  "https://www.googleapis.com/auth/calendar",
  // Google Chat
  "https://www.googleapis.com/auth/chat.messages",
  "https://www.googleapis.com/auth/chat.spaces",
  "https://www.googleapis.com/auth/chat.memberships",
  // Docs/Sheets/Slides
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
];

const PORT = 8080;
const REDIRECT_URI = `http://localhost:${PORT}`;

async function main() {
  // Load client credentials
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error("Error: client_secret.json not found at", CREDENTIALS_PATH);
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_id, client_secret } = credentials.installed;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    REDIRECT_URI
  );

  // Generate auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // Force consent to ensure we get refresh token
  });

  console.log("\n=== Google OAuth Setup ===\n");
  console.log("Opening browser for authentication...\n");
  console.log("If browser doesn't open, visit this URL:\n");
  console.log(authUrl);
  console.log("\n");

  // Try to open browser
  const openCommand =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
      ? "start"
      : "xdg-open";

  exec(`${openCommand} "${authUrl}"`, (err) => {
    if (err) {
      console.log("(Could not open browser automatically)");
    }
  });

  // Start local server to catch callback
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      res.writeHead(400);
      res.end(`Authentication failed: ${error}`);
      console.error("Authentication failed:", error);
      server.close();
      process.exit(1);
    }

    if (!code) {
      res.writeHead(400);
      res.end("No authorization code received");
      return;
    }

    try {
      // Exchange code for tokens
      const { tokens } = await oauth2Client.getToken(code);

      // Save tokens
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
      fs.chmodSync(TOKEN_PATH, 0o600); // Restrict permissions

      console.log("\n✓ Tokens saved to", TOKEN_PATH);
      console.log("\nAccess token expires:", new Date(tokens.expiry_date!).toISOString());
      console.log("Refresh token:", tokens.refresh_token ? "✓ Received" : "✗ Missing");

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html>
          <body style="font-family: system-ui; padding: 40px; text-align: center;">
            <h1>✓ Authentication Successful</h1>
            <p>You can close this window and return to the terminal.</p>
          </body>
        </html>
      `);

      // Give time for response to send
      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 1000);
    } catch (err) {
      console.error("Error exchanging code for tokens:", err);
      res.writeHead(500);
      res.end("Failed to exchange authorization code");
      server.close();
      process.exit(1);
    }
  });

  server.listen(PORT, () => {
    console.log(`Waiting for OAuth callback on http://localhost:${PORT}...`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
