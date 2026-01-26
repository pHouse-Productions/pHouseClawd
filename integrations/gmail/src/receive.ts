import { google } from "googleapis";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const CREDENTIALS_PATH = path.join(__dirname, "../client_secret.json");
const TOKEN_PATH = path.join(__dirname, "../tokens.json");
const STATE_PATH = path.join(__dirname, "../last_history_id.txt");
const EVENTS_DIR = path.join(PROJECT_ROOT, "events/pending");

const POLL_INTERVAL = 60000; // Check every 60 seconds

function getOAuth2Client() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_id, client_secret } = credentials.installed;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    "http://localhost:8080"
  );

  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  oauth2Client.setCredentials(tokens);

  oauth2Client.on("tokens", (newTokens) => {
    const currentTokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    const updatedTokens = { ...currentTokens, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(updatedTokens, null, 2));
    fs.chmodSync(TOKEN_PATH, 0o600);
  });

  return oauth2Client;
}

const auth = getOAuth2Client();
const gmail = google.gmail({ version: "v1", auth });

function getHeader(headers: { name?: string | null; value?: string | null }[], name: string): string {
  const header = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value || "";
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function extractBody(payload: any): string {
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
      if (part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }

  return "";
}

function getLastHistoryId(): string | null {
  try {
    if (fs.existsSync(STATE_PATH)) {
      return fs.readFileSync(STATE_PATH, "utf-8").trim();
    }
  } catch {}
  return null;
}

function saveLastHistoryId(historyId: string) {
  fs.writeFileSync(STATE_PATH, historyId);
}

function createEvent(email: {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
}) {
  const eventId = `gmail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const event = {
    id: eventId,
    type: "gmail:email",
    source: "gmail",
    timestamp: new Date().toISOString(),
    payload: email,
  };

  const eventPath = path.join(EVENTS_DIR, `${eventId}.json`);
  fs.writeFileSync(eventPath, JSON.stringify(event, null, 2));
  console.log(`[Gmail] Created event: ${eventId}`);
}

async function checkForNewEmails() {
  try {
    // Get current profile to get latest historyId
    const profile = await gmail.users.getProfile({ userId: "me" });
    const currentHistoryId = profile.data.historyId!;

    const lastHistoryId = getLastHistoryId();

    if (!lastHistoryId) {
      // First run - just save current state, don't process old emails
      console.log("[Gmail] First run, saving current state...");
      saveLastHistoryId(currentHistoryId);
      return;
    }

    // Get history since last check
    const history = await gmail.users.history.list({
      userId: "me",
      startHistoryId: lastHistoryId,
      historyTypes: ["messageAdded"],
    });

    if (!history.data.history) {
      // No new messages
      return;
    }

    // Collect unique message IDs from history
    const messageIds = new Set<string>();
    for (const record of history.data.history) {
      if (record.messagesAdded) {
        for (const msg of record.messagesAdded) {
          // Only process messages in INBOX
          if (msg.message?.labelIds?.includes("INBOX")) {
            messageIds.add(msg.message.id!);
          }
        }
      }
    }

    // Fetch and process each new message
    for (const messageId of messageIds) {
      try {
        const detail = await gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: "full",
        });

        const headers = detail.data.payload?.headers || [];
        const from = getHeader(headers, "From");

        // Skip emails from ourselves
        if (from.includes("vitobot87@gmail.com")) {
          continue;
        }

        const email = {
          id: messageId,
          thread_id: detail.data.threadId,
          message_id: getHeader(headers, "Message-ID") || getHeader(headers, "Message-Id"),
          from,
          to: getHeader(headers, "To"),
          subject: getHeader(headers, "Subject"),
          date: getHeader(headers, "Date"),
          body: extractBody(detail.data.payload),
        };

        console.log(`[Gmail] New email from: ${email.from}`);
        console.log(`[Gmail] Subject: ${email.subject}`);

        createEvent(email);
      } catch (err) {
        console.error(`[Gmail] Error fetching message ${messageId}:`, err);
      }
    }

    // Save the new history ID
    saveLastHistoryId(history.data.historyId || currentHistoryId);
  } catch (error: any) {
    // If historyId is too old, reset state
    if (error.code === 404 || error.message?.includes("historyId")) {
      console.log("[Gmail] History expired, resetting state...");
      const profile = await gmail.users.getProfile({ userId: "me" });
      saveLastHistoryId(profile.data.historyId!);
      return;
    }
    throw error;
  }
}

async function main() {
  console.log("[Gmail] Starting Gmail watcher (Google API)...");
  console.log(`[Gmail] Polling every ${POLL_INTERVAL / 1000} seconds`);

  // Initial check
  await checkForNewEmails();

  // Poll periodically
  setInterval(async () => {
    try {
      await checkForNewEmails();
    } catch (error) {
      console.error("[Gmail] Error checking for emails:", error);
    }
  }, POLL_INTERVAL);

  console.log("[Gmail] Watcher running...");
}

main().catch((err) => {
  console.error("[Gmail] Fatal error:", err);
  process.exit(1);
});
