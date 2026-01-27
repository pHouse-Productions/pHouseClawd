import { google } from "googleapis";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { ChannelDefinition, ChannelEvent, ChannelEventHandler, StreamEvent } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

const CREDENTIALS_PATH = "/home/ubuntu/pHouseMcp/credentials/client_secret.json";
const TOKEN_PATH = "/home/ubuntu/pHouseMcp/credentials/tokens.json";
const STATE_PATH = path.join(PROJECT_ROOT, "listeners/gmail/last_history_id.txt");
const LOGS_DIR = path.join(PROJECT_ROOT, "logs");
const LOG_FILE = path.join(LOGS_DIR, "watcher.log");

const POLL_INTERVAL = 60000; // Check every 60 seconds

function log(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

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

// Email handler config
export interface EmailConfig {
  replyTo: string;
  subject: string;
  threadId?: string;
  messageId?: string;
}

// Handler for a single email event
class EmailEventHandler implements ChannelEventHandler {
  private config: EmailConfig;
  private textBuffer: string = "";
  private isComplete: boolean = false;

  constructor(config: EmailConfig) {
    this.config = config;
  }

  onStreamEvent(event: StreamEvent): void {
    if (event.type === "result") {
      this.onComplete(event.subtype === "success" ? 0 : 1);
      return;
    }

    const text = this.extractText(event);
    if (text) {
      this.textBuffer += text;
    }
  }

  onComplete(code: number): void {
    if (this.isComplete) return;
    this.isComplete = true;

    if (this.textBuffer.trim()) {
      this.sendEmailReply(this.textBuffer.trim());
    }
    log(`[EmailChannel] Complete for ${this.config.replyTo}, code ${code}`);
  }

  private extractText(event: StreamEvent): string | null {
    switch (event.type) {
      case "assistant":
        if (event.message?.content) {
          return event.message.content
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("");
        }
        break;

      case "content_block_delta":
        if (event.delta?.type === "text_delta") {
          return event.delta.text;
        }
        break;
    }
    return null;
  }

  private sendEmailReply(body: string): void {
    if (!body || !body.trim()) return;

    const { replyTo, subject, threadId, messageId } = this.config;
    const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;

    const args = [
      "tsx",
      path.join(PROJECT_ROOT, "listeners/gmail/send-reply.ts"),
      replyTo,
      replySubject,
      body,
      threadId || "",
      messageId || "",
    ];

    try {
      const proc = spawn("npx", args, {
        cwd: PROJECT_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      proc.unref();
      log(`[EmailChannel] Sent reply to ${replyTo} (thread: ${threadId || "new"}): ${body.slice(0, 100)}${body.length > 100 ? "..." : ""}`);
    } catch (err) {
      log(`[EmailChannel] Failed to send: ${err}`);
    }
  }
}

// Email channel definition
export const EmailChannel: ChannelDefinition = {
  name: "email",
  concurrency: "session",

  async startListener(onEvent: (event: ChannelEvent) => void): Promise<() => void> {
    const auth = getOAuth2Client();
    const gmail = google.gmail({ version: "v1", auth });

    async function checkForNewEmails() {
      try {
        const profile = await gmail.users.getProfile({ userId: "me" });
        const currentHistoryId = profile.data.historyId!;

        const lastHistoryId = getLastHistoryId();

        if (!lastHistoryId) {
          log("[EmailChannel] First run, saving current state...");
          saveLastHistoryId(currentHistoryId);
          return;
        }

        const history = await gmail.users.history.list({
          userId: "me",
          startHistoryId: lastHistoryId,
          historyTypes: ["messageAdded"],
        });

        if (!history.data.history) {
          return;
        }

        const messageIds = new Set<string>();
        for (const record of history.data.history) {
          if (record.messagesAdded) {
            for (const msg of record.messagesAdded) {
              if (msg.message?.labelIds?.includes("INBOX")) {
                messageIds.add(msg.message.id!);
              }
            }
          }
        }

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

            log(`[EmailChannel] New email from: ${email.from}`);
            log(`[EmailChannel] Subject: ${email.subject}`);

            // Create session key from thread_id or subject
            const sessionKey = `email-${email.thread_id || email.subject.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 50)}`;

            const prompt = `[Email from ${email.from}]
Subject: ${email.subject}
Date: ${email.date}

${email.body}`;

            onEvent({
              sessionKey,
              prompt,
              payload: email,
            });
          } catch (err) {
            log(`[EmailChannel] Error fetching message ${messageId}: ${err}`);
          }
        }

        saveLastHistoryId(history.data.historyId || currentHistoryId);
      } catch (error: any) {
        if (error.code === 404 || error.message?.includes("historyId")) {
          log("[EmailChannel] History expired, resetting state...");
          const profile = await gmail.users.getProfile({ userId: "me" });
          saveLastHistoryId(profile.data.historyId!);
          return;
        }
        throw error;
      }
    }

    log("[EmailChannel] Starting email listener...");
    log(`[EmailChannel] Polling every ${POLL_INTERVAL / 1000} seconds`);

    // Initial check
    await checkForNewEmails();

    // Poll periodically
    const interval = setInterval(async () => {
      try {
        await checkForNewEmails();
      } catch (error) {
        log(`[EmailChannel] Error checking for emails: ${error}`);
      }
    }, POLL_INTERVAL);

    log("[EmailChannel] Listener running...");

    // Return stop function
    return () => {
      clearInterval(interval);
      log("[EmailChannel] Listener stopped");
    };
  },

  createHandler(event: ChannelEvent): ChannelEventHandler {
    const { from, subject, thread_id, message_id } = event.payload;
    return new EmailEventHandler({
      replyTo: from,
      subject,
      threadId: thread_id,
      messageId: message_id,
    });
  },
};
