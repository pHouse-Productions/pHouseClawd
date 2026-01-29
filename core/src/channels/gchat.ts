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
const STATE_PATH = path.join(PROJECT_ROOT, "listeners/gchat/last_message_time.txt");
const LOGS_DIR = path.join(PROJECT_ROOT, "logs");
const LOG_FILE = path.join(LOGS_DIR, "watcher.log");
const SEND_SCRIPT = path.join(PROJECT_ROOT, "listeners/gchat/send-message.ts");

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

// Verbosity levels
type Verbosity = "streaming" | "progress" | "final";

const FLUSH_INTERVAL_MS = 2000;
const MIN_CHARS_TO_FLUSH = 50;

// Handler for a single GChat event
class GChatEventHandler implements ChannelEventHandler {
  private spaceName: string;
  private messageName: string;
  private verbosity: Verbosity;
  private textBuffer: string = "";
  private lastFlush: number = Date.now();
  private flushTimer: NodeJS.Timeout | null = null;
  private isComplete: boolean = false;
  private reactionName: string | null = null;

  constructor(spaceName: string, messageName: string, verbosity: Verbosity = "streaming") {
    this.spaceName = spaceName;
    this.messageName = messageName;
    this.verbosity = verbosity;

    // Add eyes reaction to show we're working on it
    this.addWorkingReaction();
  }

  private async addWorkingReaction(): Promise<void> {
    if (!this.messageName) return;

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
    } catch (err) {
      log(`[GChatChannel] Failed to remove working reaction: ${err}`);
    }
  }

  onStreamEvent(event: StreamEvent): void {
    if (event.type === "result") {
      this.onComplete(event.subtype === "success" ? 0 : 1);
      return;
    }

    const { text, progress } = this.extractRelayInfo(event);

    if (text) {
      if (this.verbosity === "streaming") {
        this.bufferText(text);
      } else if (this.verbosity === "final") {
        this.textBuffer += text;
      }
    }

    if (this.verbosity === "progress" && progress) {
      this.sendMessage(progress);
    }
  }

  onComplete(code: number): void {
    if (this.isComplete) return;
    this.isComplete = true;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.textBuffer.trim()) {
      this.sendMessage(this.textBuffer.trim());
      this.textBuffer = "";
    }

    // Remove the working reaction
    this.removeWorkingReaction();

    log(`[GChatChannel] Complete for space ${this.spaceName}, code ${code}`);
  }

  private extractRelayInfo(event: StreamEvent): { text: string | null; progress: string | null } {
    const result: { text: string | null; progress: string | null } = { text: null, progress: null };

    switch (event.type) {
      case "assistant":
        if (event.message?.content) {
          const text = event.message.content
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("");
          if (text) result.text = text;
        }
        break;

      case "content_block_start":
        if (event.content_block?.type === "tool_use") {
          result.progress = `Using ${event.content_block.name}...`;
        }
        break;

      case "content_block_delta":
        if (event.delta?.type === "text_delta") {
          result.text = event.delta.text;
        }
        break;

      case "error":
        result.progress = `Error: ${event.error?.message || "Unknown error"}`;
        break;
    }

    return result;
  }

  private bufferText(text: string): void {
    this.textBuffer += text;

    const timeSinceFlush = Date.now() - this.lastFlush;
    if (this.textBuffer.length >= MIN_CHARS_TO_FLUSH || timeSinceFlush > FLUSH_INTERVAL_MS) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
    }
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const text = this.textBuffer.trim();
    if (text) {
      this.sendMessage(text);
      this.textBuffer = "";
      this.lastFlush = Date.now();
    }
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

              const sessionKey = `gchat-${spaceName.replace(/\//g, "-")}`;
              const prompt = `[Google Chat from ${senderDisplayName || "Someone"} | space: ${spaceName} | msg: ${msgName}]: ${text}`;

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
                  verbosity: "streaming" as Verbosity,
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
};
