import { google } from "googleapis";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { ChannelDefinition, ChannelEvent, ChannelEventHandler, StreamEvent } from "./types.js";
import { OutputHandler, type Verbosity } from "./output-handler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

const CREDENTIALS_PATH = "/home/ubuntu/pHouseMcp/credentials/client_secret.json";
const TOKEN_PATH = "/home/ubuntu/pHouseMcp/credentials/tokens.json";
const STATE_PATH = path.join(PROJECT_ROOT, "listeners/gchat/last_message_time.txt");
const LOGS_DIR = path.join(PROJECT_ROOT, "logs");
const LOG_FILE = path.join(LOGS_DIR, "watcher.log");
const SEND_SCRIPT = path.join(PROJECT_ROOT, "listeners/gchat/send-message.ts");
const FILES_DIR = path.join(PROJECT_ROOT, "memory/gchat/files");

// Ensure files directory exists
if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

const POLL_INTERVAL = 10000; // Check every 10 seconds

// Module-level tracking for sent messages to prevent echo loops
// Key: normalized message text, Value: timestamp
const sentMessageTexts = new Map<string, number>();
const SENT_MESSAGE_ECHO_WINDOW_MS = 60000; // 1 minute window

function trackSentMessage(text: string) {
  const key = text.trim().toLowerCase();
  sentMessageTexts.set(key, Date.now());
  // Clean up old entries and limit size
  const now = Date.now();
  for (const [k, timestamp] of sentMessageTexts) {
    if (now - timestamp > SENT_MESSAGE_ECHO_WINDOW_MS) {
      sentMessageTexts.delete(k);
    }
  }
  if (sentMessageTexts.size > 100) {
    const firstKey = sentMessageTexts.keys().next().value;
    if (firstKey) sentMessageTexts.delete(firstKey);
  }
}

function isSentMessage(text: string): boolean {
  const key = text.trim().toLowerCase();
  const timestamp = sentMessageTexts.get(key);
  if (timestamp && Date.now() - timestamp < SENT_MESSAGE_ECHO_WINDOW_MS) {
    return true;
  }
  return false;
}

// Security config file path
const GCHAT_SECURITY_CONFIG_FILE = path.join(PROJECT_ROOT, "config/gchat-security.json");

interface GChatSecurityConfig {
  allowedSpaces: string[];
  myUserId?: string; // Our user ID to filter out self-messages (format: "users/123456789")
  userNames?: Record<string, string>; // Mapping of user IDs to display names
}

function loadSecurityConfig(): GChatSecurityConfig {
  try {
    if (fs.existsSync(GCHAT_SECURITY_CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(GCHAT_SECURITY_CONFIG_FILE, "utf-8"));
      return {
        allowedSpaces: config.allowedSpaces || [],
        myUserId: config.myUserId || undefined,
        userNames: config.userNames || {},
      };
    }
  } catch (err) {
    log(`[GChatChannel] Failed to load security config: ${err}`);
  }
  return { allowedSpaces: [], userNames: {} };
}

function log(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

// Download attachment from Google Chat using media.download
async function downloadGChatAttachment(
  auth: any,
  resourceName: string,
  destPath: string
): Promise<void> {
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  const accessToken = tokens.access_token;

  // Use fetch with alt=media like the curl that worked
  const url = `https://chat.googleapis.com/v1/media/${resourceName}?alt=media`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
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

function getLastMessageTime(): Date | null {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const timeStr = fs.readFileSync(STATE_PATH, "utf-8").trim();
      return new Date(timeStr);
    }
  } catch {}
  return null;
}

function saveLastMessageTime(time: Date) {
  fs.writeFileSync(STATE_PATH, time.toISOString());
}

// Get our own email to filter out self-messages
async function getMyEmail(auth: any): Promise<string | null> {
  try {
    const gmail = google.gmail({ version: "v1", auth });
    const profile = await gmail.users.getProfile({ userId: "me" });
    return profile.data.emailAddress || null;
  } catch (err) {
    log(`[GChatChannel] Error getting email: ${err}`);
    return null;
  }
}

// Handler for a single GChat event
class GChatEventHandler implements ChannelEventHandler {
  private spaceName: string;
  private messageName: string;
  private outputHandler: OutputHandler;
  private reactionName: string | null = null;

  constructor(spaceName: string, messageName: string, verbosity: Verbosity = "streaming") {
    this.spaceName = spaceName;
    this.messageName = messageName;

    this.outputHandler = new OutputHandler(
      { verbosity },
      {
        onSend: (message) => this.sendMessage(message),
        // GChat uses emoji reactions as a working indicator (no typing API)
        // onWorkStarted adds 👀 reaction - only needs to be called once
        onWorkStarted: () => this.addWorkingReaction(),
        onWorkComplete: () => this.removeWorkingReaction(),
      }
    );
  }

  private async addWorkingReaction(): Promise<void> {
    // Only add reaction once
    if (this.reactionName || !this.messageName) return;

    try {
      const auth = getOAuth2Client();
      const chat = google.chat({ version: "v1", auth });
      const response = await chat.spaces.messages.reactions.create({
        parent: this.messageName,
        requestBody: {
          emoji: { unicode: "👀" },
        },
      });
      this.reactionName = response.data.name || null;
      log(`[GChatChannel] Added working reaction to ${this.messageName}`);
    } catch (err) {
      log(`[GChatChannel] Failed to add working reaction: ${err}`);
    }
  }

  private async removeWorkingReaction(): Promise<void> {
    if (!this.reactionName) return;

    try {
      const auth = getOAuth2Client();
      const chat = google.chat({ version: "v1", auth });
      await chat.spaces.messages.reactions.delete({
        name: this.reactionName,
      });
      log(`[GChatChannel] Removed working reaction from ${this.messageName}`);
      this.reactionName = null;
    } catch (err) {
      log(`[GChatChannel] Failed to remove working reaction: ${err}`);
    }
  }

  onStreamEvent(event: StreamEvent): void {
    this.outputHandler.onStreamEvent(event);
  }

  onComplete(code: number): void {
    this.outputHandler.onComplete(code);
    log(`[GChatChannel] Complete for space ${this.spaceName}, code ${code}`);
  }

  private sendMessage(message: string): void {
    if (!message || !message.trim()) return;

    // Track this message to prevent echo loops
    trackSentMessage(message);

    try {
      const proc = spawn("npx", ["tsx", SEND_SCRIPT, this.spaceName, message], {
        cwd: PROJECT_ROOT,
        stdio: ["ignore", "ignore", "ignore"],
        detached: true,
      });
      proc.unref();
      log(`[GChatChannel] Sent to ${this.spaceName}: ${message.slice(0, 100)}${message.length > 100 ? "..." : ""}`);
    } catch (err) {
      log(`[GChatChannel] Failed to send: ${err}`);
    }
  }
}

// Google Chat channel definition
export const GChatChannel: ChannelDefinition = {
  name: "gchat",
  concurrency: "session",

  async startListener(onEvent: (event: ChannelEvent) => void): Promise<() => void> {
    const auth = getOAuth2Client();
    const chat = google.chat({ version: "v1", auth });

    // Get our own email to filter out our messages
    const myEmail = await getMyEmail(auth);
    log(`[GChatChannel] My email: ${myEmail || "unknown"}`);

    // Get our user ID from config or try to detect it
    const securityConfig = loadSecurityConfig();
    let myUserId: string | null = securityConfig.myUserId || null;

    if (myUserId) {
      log(`[GChatChannel] Using configured user ID: ${myUserId}`);
    } else {
      log(`[GChatChannel] No myUserId configured - run list-members.ts to find your user ID`);
    }

    // Track processed messages to avoid duplicates
    const processedMessages = new Set<string>();

    // Track recent message texts to detect echoes (text -> timestamp)
    const recentMessageTexts = new Map<string, number>();
    const ECHO_DETECTION_WINDOW_MS = 60000; // 1 minute window

    async function checkForNewMessages() {
      const config = loadSecurityConfig();

      if (config.allowedSpaces.length === 0) {
        return;
      }

      try {
        const lastMessageTime = getLastMessageTime();
        let latestTime = lastMessageTime || new Date(Date.now() - 60000);

        for (const spaceName of config.allowedSpaces) {
          try {
            const response = await chat.spaces.messages.list({
              parent: spaceName,
              pageSize: 25,
              orderBy: "createTime desc",
            });

            const messages = response.data.messages || [];

            // Filter to new messages and reverse to process oldest first
            const newMessages = messages
              .filter((msg) => {
                const createTime = new Date(msg.createTime || 0);
                return createTime > (lastMessageTime || new Date(0));
              })
              .reverse();

            for (const msg of newMessages) {
              const msgName = msg.name || "";

              // Skip if already processed
              if (processedMessages.has(msgName)) {
                continue;
              }

              // Mark as processed
              if (msgName) {
                processedMessages.add(msgName);
                // Limit set size
                if (processedMessages.size > 1000) {
                  const first = processedMessages.values().next().value;
                  if (first) processedMessages.delete(first);
                }
              }

              // Skip messages from ourselves
              const senderUserId = msg.sender?.name;
              const senderType = (msg.sender as any)?.type;

              // Log sender details for debugging
              log(`[GChatChannel] Message sender: userId=${senderUserId}, type=${senderType}, myUserId=${myUserId}`);

              // Method 1: Check by user ID if we know it
              if (myUserId && senderUserId === myUserId) {
                log(`[GChatChannel] Skipping own message (by user ID): ${msg.text?.slice(0, 30)}...`);
                continue;
              }

              // Method 2: Skip messages from HUMAN type if they match our user ID pattern
              // When we send via Chat API with OAuth, sender might be "users/..." matching our ID
              if (senderType === "HUMAN" && senderUserId && myUserId && senderUserId === myUserId) {
                log(`[GChatChannel] Skipping own message (by type HUMAN + user ID): ${msg.text?.slice(0, 30)}...`);
                continue;
              }

              // Get the text first (before async lookup)
              const text = msg.text || "";
              if (!text.trim()) continue;

              // Get display name - try from message first, then config mapping
              let senderDisplayName = msg.sender?.displayName || "";
              if (!senderDisplayName && senderUserId && config.userNames) {
                senderDisplayName = config.userNames[senderUserId] || "";
                if (senderDisplayName) {
                  log(`[GChatChannel] Resolved name from config: ${senderUserId} -> ${senderDisplayName}`);
                }
              }

              // Method 3: Check if this is a message we sent (echo detection from outbound messages)
              if (isSentMessage(text)) {
                log(`[GChatChannel] Skipping own sent message (echo): ${text.slice(0, 30)}...`);
                continue;
              }

              // Method 4: Echo detection - skip if we recently saw the exact same text
              // This catches cases where our sent messages come back with different sender info
              const textKey = text.trim().toLowerCase();
              const now = Date.now();

              // Clean up old entries
              for (const [key, timestamp] of recentMessageTexts) {
                if (now - timestamp > ECHO_DETECTION_WINDOW_MS) {
                  recentMessageTexts.delete(key);
                }
              }

              // Check if this is a likely echo (same text within the window)
              if (recentMessageTexts.has(textKey)) {
                log(`[GChatChannel] Skipping likely echo (duplicate text): ${text.slice(0, 30)}...`);
                continue;
              }

              // Track this message text
              recentMessageTexts.set(textKey, now);
              // Limit map size
              if (recentMessageTexts.size > 100) {
                const firstKey = recentMessageTexts.keys().next().value;
                if (firstKey) recentMessageTexts.delete(firstKey);
              }

              const createTime = new Date(msg.createTime || Date.now());

              log(`[GChatChannel] New message from ${senderDisplayName}: ${text.slice(0, 50)}...`);

              if (createTime > latestTime) {
                latestTime = createTime;
              }

              // Extract and download attachments if present
              const rawAttachments = msg.attachment || [];
              const downloadedFiles: { path: string; name: string; type: string }[] = [];

              for (const att of rawAttachments) {
                const resourceName = att.attachmentDataRef?.resourceName;
                if (resourceName) {
                  const contentName = att.contentName || "file";
                  const contentType = att.contentType || "application/octet-stream";
                  const timestamp = Date.now();
                  const safeFileName = contentName.replace(/[^a-zA-Z0-9._-]/g, "_");
                  const filename = `${timestamp}_${safeFileName}`;
                  const filePath = path.join(FILES_DIR, filename);

                  try {
                    await downloadGChatAttachment(auth, resourceName, filePath);
                    downloadedFiles.push({ path: filePath, name: contentName, type: contentType });
                    log(`[GChatChannel] Downloaded attachment: ${contentName} -> ${filePath}`);
                  } catch (err: any) {
                    log(`[GChatChannel] Failed to download attachment ${contentName}: ${err.message}`);
                  }
                }
              }

              const sessionKey = `gchat-${spaceName.replace(/\//g, "-")}`;

              // Build prompt with file paths like Telegram does
              let prompt = `[Google Chat from ${senderDisplayName || "Someone"} | space: ${spaceName} | msg: ${msgName}]: ${text}`;
              if (downloadedFiles.length > 0) {
                for (const file of downloadedFiles) {
                  const isImage = file.type.startsWith("image/");
                  const isPdf = file.type === "application/pdf";
                  if (isImage) {
                    prompt += `\n\n[Image: ${file.name}]\nIMPORTANT: Use the Read tool to view the image at: ${file.path}`;
                  } else if (isPdf) {
                    prompt += `\n\n[PDF: ${file.name}]\nIMPORTANT: The PDF has been saved to: ${file.path}`;
                  } else {
                    prompt += `\n\n[File: ${file.name} (${file.type})]\nIMPORTANT: The file has been saved to: ${file.path}`;
                  }
                }
              }

              onEvent({
                sessionKey,
                prompt,
                payload: {
                  type: "message",
                  space_name: spaceName,
                  sender_name: senderDisplayName || "Someone",
                  sender_user_id: senderUserId,
                  text,
                  message_name: msgName,
                  downloaded_files: downloadedFiles,
                  verbosity: "streaming" as Verbosity,
                },
                message: {
                  text,
                  from: senderDisplayName || "Someone",
                  isMessage: true,
                },
              });
            }
          } catch (err: any) {
            log(`[GChatChannel] Error checking space ${spaceName}: ${err.message}`);
          }
        }

        saveLastMessageTime(latestTime);

      } catch (error: any) {
        log(`[GChatChannel] Error in checkForNewMessages: ${error.message}`);
      }
    }

    log("[GChatChannel] Starting Google Chat listener...");
    log(`[GChatChannel] Polling every ${POLL_INTERVAL / 1000} seconds`);

    const stateDir = path.dirname(STATE_PATH);
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }

    await checkForNewMessages();

    const interval = setInterval(async () => {
      try {
        await checkForNewMessages();
      } catch (error) {
        log(`[GChatChannel] Error checking for messages: ${error}`);
      }
    }, POLL_INTERVAL);

    log("[GChatChannel] Listener running...");

    return () => {
      clearInterval(interval);
      log("[GChatChannel] Listener stopped");
    };
  },

  createHandler(event: ChannelEvent): ChannelEventHandler {
    const verbosity = event.payload.verbosity || "streaming";
    return new GChatEventHandler(event.payload.space_name, event.payload.message_name, verbosity);
  },

  getSessionKey(payload: any): string {
    // Use space name for session key
    return `gchat-${payload.space_name.replace(/\//g, "-")}`;
  },

  getChannelContext(): string {
    return `[Channel: Google Chat]
- To react to messages: Use mcp__google-chat__add_reaction with the message ID from this prompt
- To remove reactions: Use mcp__google-chat__remove_reaction
- To list messages: Use mcp__google-chat__list_messages with the space ID
- To get attachments: Use mcp__google-chat__get_attachments with the message name
- To download attachments: Use mcp__google-chat__download_attachment with the attachment name and output path
- To send attachments: Use mcp__google-chat__send_attachment with the space name and file path`;
  },
};
