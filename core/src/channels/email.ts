import { google } from "googleapis";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { marked } from "marked";
import type { Channel, ChannelEvent, StreamHandler, ChannelDefinition, ChannelEventHandler, StreamEvent } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

const CREDENTIALS_PATH = "/home/ubuntu/pHouseMcp/credentials/client_secret.json";
const TOKEN_PATH = "/home/ubuntu/pHouseMcp/credentials/tokens.json";
const STATE_PATH = path.join(PROJECT_ROOT, "listeners/gmail/last_history_id.txt");
const LOGS_DIR = path.join(PROJECT_ROOT, "logs");
const LOG_FILE = path.join(LOGS_DIR, "watcher.log");

const POLL_INTERVAL = 60000; // Check every 60 seconds

// Email attachments directory
const FILES_DIR = path.join(PROJECT_ROOT, "memory/email/files");

// Ensure files directory exists
if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

// Email security config
const EMAIL_SECURITY_CONFIG_FILE = path.join(PROJECT_ROOT, "config/email-security.json");

interface EmailSecurityConfig {
  trustedEmailAddresses: string[];
  forwardUntrustedTo: string[];
}

function loadEmailSecurityConfig(): EmailSecurityConfig {
  try {
    if (fs.existsSync(EMAIL_SECURITY_CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(EMAIL_SECURITY_CONFIG_FILE, "utf-8"));
      // Handle both array and legacy string format for forwardUntrustedTo
      let forwardTo = config.forwardUntrustedTo || [];
      if (typeof forwardTo === "string") {
        forwardTo = forwardTo ? [forwardTo] : [];
      }
      // Fallback: if forwardUntrustedTo is empty, use trustedEmailAddresses
      if (forwardTo.length === 0) {
        forwardTo = config.trustedEmailAddresses || [];
      }
      return {
        trustedEmailAddresses: config.trustedEmailAddresses || [],
        forwardUntrustedTo: forwardTo,
      };
    }
  } catch (err) {
    log(`[EmailChannel] Failed to load security config: ${err}`);
  }
  return { trustedEmailAddresses: [], forwardUntrustedTo: [] };
}

function isTrustedSender(fromAddress: string): boolean {
  const config = loadEmailSecurityConfig();
  const emailAddress = fromAddress.match(/<(.+)>/)?.[1] || fromAddress;
  return config.trustedEmailAddresses.some(
    (trusted: string) => trusted.toLowerCase() === emailAddress.toLowerCase()
  );
}

async function forwardUntrustedEmail(email: { from: string; to: string; cc: string; date: string; subject: string; body: string }): Promise<void> {
  const config = loadEmailSecurityConfig();
  if (config.forwardUntrustedTo.length === 0) return;

  // Extract email address from "Name <email@address.com>" format if present
  const emailMatch = email.from.match(/<(.+)>/);
  const emailAddress = emailMatch ? emailMatch[1] : email.from;
  const displayName = emailMatch ? email.from.replace(/<.+>/, "").trim() : "";

  const forwardSubject = `Fwd: ${email.subject}`;

  // Build header lines with explicit email addresses
  const headerLines: string[] = [];
  headerLines.push(displayName ? `From: ${displayName}` : `From: ${emailAddress}`);
  if (displayName) headerLines.push(`Email: ${emailAddress}`);
  if (email.to) headerLines.push(`To: ${email.to}`);
  if (email.cc) headerLines.push(`CC: ${email.cc}`);
  headerLines.push(`Date: ${email.date}`);
  headerLines.push(`Subject: ${email.subject}`);

  const forwardBody = `---------- Forwarded message ----------\n${headerLines.join("\n")}\n\n${email.body}`;

  // Forward to all addresses in the list
  for (const recipient of config.forwardUntrustedTo) {
    const args = [
      "tsx",
      path.join(PROJECT_ROOT, "listeners/gmail/send-reply.ts"),
      recipient,
      forwardSubject,
      forwardBody,
      "", // no HTML
      "", // no threadId
      "", // no messageId
    ];

    try {
      const proc = spawn("npx", args, {
        cwd: PROJECT_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      proc.unref();
      log(`[EmailChannel] Forwarded untrusted email to ${recipient}`);
    } catch (err) {
      log(`[EmailChannel] Failed to forward to ${recipient}: ${err}`);
    }
  }
}

function log(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

function getOAuth2Client() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const creds = credentials.installed || credentials.web;
  if (!creds) {
    throw new Error("Invalid credentials file: must contain 'installed' or 'web' key");
  }
  const { client_id, client_secret } = creds;

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

interface AttachmentInfo {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
}

function extractAttachments(payload: any): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];

  function scanParts(parts: any[]) {
    for (const part of parts) {
      // Check if this part is an attachment (has a filename and attachmentId)
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType || "application/octet-stream",
          attachmentId: part.body.attachmentId,
          size: part.body.size || 0,
        });
      }
      // Recursively scan nested parts
      if (part.parts) {
        scanParts(part.parts);
      }
    }
  }

  if (payload.parts) {
    scanParts(payload.parts);
  }

  return attachments;
}

async function downloadEmailAttachment(
  gmail: any,
  messageId: string,
  attachment: AttachmentInfo
): Promise<string> {
  const timestamp = Date.now();
  const safeFileName = attachment.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${timestamp}_${safeFileName}`;
  const filePath = path.join(FILES_DIR, filename);

  const response = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachment.attachmentId,
  });

  const data = response.data.data;
  if (data) {
    // Gmail returns base64url encoded data
    const buffer = Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    fs.writeFileSync(filePath, buffer);
    log(`[EmailChannel] Downloaded attachment: ${attachment.filename} -> ${filePath}`);
    return filePath;
  }

  throw new Error("No attachment data received");
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

// Stream handler for Email - sends replies
class EmailStreamHandler implements StreamHandler {
  private config: EmailConfig;

  constructor(config: EmailConfig) {
    this.config = config;
  }

  async relayMessage(text: string): Promise<void> {
    if (!text || !text.trim()) return;

    const { replyTo, subject, threadId, messageId } = this.config;
    const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;

    // Convert markdown to HTML for nicer formatting
    const htmlBody = marked.parse(text) as string;

    const args = [
      "tsx",
      path.join(PROJECT_ROOT, "listeners/gmail/send-reply.ts"),
      replyTo,
      replySubject,
      text,
      htmlBody,
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
      log(`[EmailChannel] Sent reply to ${replyTo} (thread: ${threadId || "new"}): ${text.slice(0, 100)}${text.length > 100 ? "..." : ""}`);
    } catch (err) {
      log(`[EmailChannel] Failed to send: ${err}`);
    }
  }

  // Email has no typing indicator or reactions
  async startTyping(): Promise<void> {}
  async stopTyping(): Promise<void> {}
  async startReaction(): Promise<void> {}
  async stopReaction(): Promise<void> {}
}

// Legacy handler wrapper for backwards compatibility with watcher
// TODO: Remove after watcher migration
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
      // For assistant message blocks, add newline separator if buffer already has content
      // This prevents chunks from getting mashed together
      if (event.type === "assistant" && this.textBuffer.length > 0 && !this.textBuffer.endsWith("\n")) {
        this.textBuffer += "\n\n";
      }
      this.textBuffer += text;
    }
  }

  onComplete(code: number): void {
    if (this.isComplete) return;
    this.isComplete = true;

    if (this.textBuffer.trim()) {
      const streamHandler = new EmailStreamHandler(this.config);
      streamHandler.relayMessage(this.textBuffer.trim());
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
}

// Email channel definition
export const EmailChannel: Channel & ChannelDefinition = {
  name: "email",
  concurrency: "session",

  // New interface: listen()
  async listen(onEvent: (event: ChannelEvent) => void): Promise<() => void> {
    return this.startListener(onEvent);
  },

  // Legacy interface: startListener()
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

            // Extract and download attachments
            const attachmentInfos = extractAttachments(detail.data.payload);
            const downloadedFiles: { path: string; name: string; type: string }[] = [];

            for (const attInfo of attachmentInfos) {
              try {
                const filePath = await downloadEmailAttachment(gmail, messageId, attInfo);
                downloadedFiles.push({
                  path: filePath,
                  name: attInfo.filename,
                  type: attInfo.mimeType,
                });
              } catch (err: any) {
                log(`[EmailChannel] Failed to download attachment ${attInfo.filename}: ${err.message}`);
              }
            }

            const email = {
              id: messageId,
              thread_id: detail.data.threadId,
              message_id: getHeader(headers, "Message-ID") || getHeader(headers, "Message-Id"),
              from,
              to: getHeader(headers, "To"),
              cc: getHeader(headers, "Cc") || getHeader(headers, "CC"),
              subject: getHeader(headers, "Subject"),
              date: getHeader(headers, "Date"),
              body: extractBody(detail.data.payload),
              downloaded_files: downloadedFiles,
            };

            log(`[EmailChannel] New email from: ${email.from}`);
            log(`[EmailChannel] Subject: ${email.subject}`);
            if (downloadedFiles.length > 0) {
              log(`[EmailChannel] Downloaded ${downloadedFiles.length} attachment(s)`);
            }

            // Security check - filter untrusted senders
            // NOTE: Users can ALSO set up Gmail filters for richer forwarding (preserves attachments)
            // This code-based forwarding is simpler to configure via dashboard but less rich
            if (!isTrustedSender(email.from)) {
              log(`[EmailChannel] Untrusted sender: ${email.from} - blocking auto-reply`);
              await forwardUntrustedEmail(email);
              continue;
            }

            // Session key is based on thread_id for parallel thread processing
            const sessionKey = `email-${email.thread_id}`;

            // Build recipient info
            const recipients: string[] = [];
            if (email.to) recipients.push(`To: ${email.to}`);
            if (email.cc) recipients.push(`CC: ${email.cc}`);
            const recipientInfo = recipients.length > 0 ? `${recipients.join('\n')}\n` : '';

            let prompt = `[Email from ${email.from}]
${recipientInfo}Subject: ${email.subject}
Date: ${email.date}

${email.body}`;

            // Add attachment file paths like GChat/Telegram do
            if (downloadedFiles.length > 0) {
              for (const file of downloadedFiles) {
                const isImage = file.type.startsWith("image/");
                const isPdf = file.type === "application/pdf";
                if (isImage) {
                  prompt += `\n\n[Image Attachment: ${file.name}]\nIMPORTANT: Use the Read tool to view the image at: ${file.path}`;
                } else if (isPdf) {
                  prompt += `\n\n[PDF Attachment: ${file.name}]\nIMPORTANT: The PDF has been saved to: ${file.path}`;
                } else {
                  prompt += `\n\n[Attachment: ${file.name} (${file.type})]\nIMPORTANT: The file has been saved to: ${file.path}`;
                }
              }
            }

            onEvent({
              sessionKey,
              prompt,
              payload: email,
              message: {
                text: email.body,
                from: email.from,
                isMessage: true,
              },
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

  // New interface: createStreamHandler()
  createStreamHandler(event: ChannelEvent): StreamHandler {
    const { from, subject, thread_id, message_id } = event.payload;
    return new EmailStreamHandler({
      replyTo: from,
      subject,
      threadId: thread_id,
      messageId: message_id,
    });
  },

  // Legacy interface: createHandler()
  createHandler(event: ChannelEvent): ChannelEventHandler {
    const { from, subject, thread_id, message_id } = event.payload;
    return new EmailEventHandler({
      replyTo: from,
      subject,
      threadId: thread_id,
      messageId: message_id,
    });
  },

  getSessionKey(payload: any): string {
    // Use thread_id for parallel thread processing
    return `email-${payload.thread_id}`;
  },

  // New interface: getCustomPrompt()
  getCustomPrompt(): string {
    return this.getChannelContext!();
  },

  // Legacy interface: getChannelContext()
  getChannelContext(): string {
    return `[Channel: Email]
- Replies are sent automatically through the relay system - do NOT use send_email for replies
- To send attachments with a reply, use mcp__gmail__send_email with the attachments parameter (array of file paths)
- Each email thread runs independently - different threads can process in parallel`;
  },
};
