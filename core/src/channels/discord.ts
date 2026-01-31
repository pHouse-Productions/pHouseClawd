import { Client, GatewayIntentBits, TextChannel, DMChannel, NewsChannel, AttachmentBuilder, Message } from "discord.js";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as https from "https";
import { fileURLToPath } from "url";
import type { ChannelDefinition, ChannelEvent, ChannelEventHandler, StreamEvent } from "./types.js";
import { OutputHandler, type Verbosity } from "./output-handler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

const SEND_SCRIPT = path.join(PROJECT_ROOT, "listeners/discord/send.ts");
const TYPING_SCRIPT = path.join(PROJECT_ROOT, "listeners/discord/typing.ts");
const LOGS_DIR = path.join(PROJECT_ROOT, "logs");
const LOG_FILE = path.join(LOGS_DIR, "watcher.log");
const FILES_DIR = path.join(PROJECT_ROOT, "memory/discord/files");

// Ensure directories exist
if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

function log(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

// Security config file path
const DISCORD_SECURITY_CONFIG_FILE = path.join(PROJECT_ROOT, "config/discord-security.json");

interface DiscordSecurityConfig {
  allowedChannels: string[]; // Channel IDs to listen to
  allowedGuilds?: string[]; // Optional: Guild IDs (if empty, uses channels list)
  myUserId?: string; // Bot's user ID to filter out self-messages
  userNames?: Record<string, string>; // Mapping of user IDs to display names
}

function loadSecurityConfig(): DiscordSecurityConfig {
  try {
    if (fs.existsSync(DISCORD_SECURITY_CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(DISCORD_SECURITY_CONFIG_FILE, "utf-8"));
      return {
        allowedChannels: config.allowedChannels || [],
        allowedGuilds: config.allowedGuilds || [],
        myUserId: config.myUserId || undefined,
        userNames: config.userNames || {},
      };
    }
  } catch (err) {
    log(`[DiscordChannel] Failed to load security config: ${err}`);
  }
  return { allowedChannels: [], userNames: {} };
}

// Download attachment from Discord
async function downloadAttachment(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          https.get(redirectUrl, (redirectResponse) => {
            redirectResponse.pipe(file);
            file.on("finish", () => {
              file.close();
              resolve();
            });
          }).on("error", (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
          });
          return;
        }
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    }).on("error", (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

// Module-level tracking for sent messages to prevent echo loops
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

// Handler for a single Discord event
class DiscordEventHandler implements ChannelEventHandler {
  private channelId: string;
  private messageId: string;
  private outputHandler: OutputHandler;
  private discordClient: Client | null = null;
  private hasAddedReaction = false;

  constructor(channelId: string, messageId: string, verbosity: Verbosity = "streaming", discordClient?: Client) {
    this.channelId = channelId;
    this.messageId = messageId;
    this.discordClient = discordClient || null;

    this.outputHandler = new OutputHandler(
      { verbosity },
      {
        onSend: (message) => this.sendMessage(message),
        // Discord has both typing indicator AND reactions - we use both
        // Typing indicator refreshes via the 4-second interval in OutputHandler
        // Reaction is added once and removed when complete
        onWorkStarted: () => {
          this.sendTypingIndicator();
          this.addWorkingReaction();
        },
        onWorkComplete: () => this.removeWorkingReaction(),
      }
    );
  }

  private async addWorkingReaction(): Promise<void> {
    // Only add reaction once
    if (this.hasAddedReaction || !this.discordClient || !this.messageId) return;

    try {
      const channel = await this.discordClient.channels.fetch(this.channelId);
      if (channel && (channel instanceof TextChannel || channel instanceof DMChannel || channel instanceof NewsChannel)) {
        const message = await channel.messages.fetch(this.messageId);
        await message.react("👀");
        this.hasAddedReaction = true;
        log(`[DiscordChannel] Added working reaction to ${this.messageId}`);
      }
    } catch (err) {
      log(`[DiscordChannel] Failed to add working reaction: ${err}`);
    }
  }

  private async removeWorkingReaction(): Promise<void> {
    if (!this.hasAddedReaction || !this.discordClient || !this.messageId) return;

    try {
      const channel = await this.discordClient.channels.fetch(this.channelId);
      if (channel && (channel instanceof TextChannel || channel instanceof DMChannel || channel instanceof NewsChannel)) {
        const message = await channel.messages.fetch(this.messageId);
        const reaction = message.reactions.cache.find(r => r.emoji.name === "👀");
        if (reaction && this.discordClient.user) {
          await reaction.users.remove(this.discordClient.user.id);
          log(`[DiscordChannel] Removed working reaction from ${this.messageId}`);
        }
      }
    } catch (err) {
      log(`[DiscordChannel] Failed to remove working reaction: ${err}`);
    }
  }

  onStreamEvent(event: StreamEvent): void {
    this.outputHandler.onStreamEvent(event);
  }

  onComplete(code: number): void {
    this.outputHandler.onComplete(code);
    log(`[DiscordChannel] Complete for channel ${this.channelId}, code ${code}`);
  }

  private sendMessage(message: string): void {
    if (!message || !message.trim()) return;

    // Track this message to prevent echo loops
    trackSentMessage(message);

    try {
      const proc = spawn("npx", ["tsx", SEND_SCRIPT, this.channelId, message], {
        cwd: PROJECT_ROOT,
        stdio: ["ignore", "ignore", "ignore"],
        detached: true,
      });
      proc.unref();
      log(`[DiscordChannel] Sent to ${this.channelId}: ${message.slice(0, 100)}${message.length > 100 ? "..." : ""}`);
    } catch (err) {
      log(`[DiscordChannel] Failed to send: ${err}`);
    }
  }

  private sendTypingIndicator(): void {
    try {
      const proc = spawn("npx", ["tsx", TYPING_SCRIPT, this.channelId], {
        cwd: PROJECT_ROOT,
        stdio: ["ignore", "ignore", "ignore"],
        detached: true,
      });
      proc.unref();
    } catch (err) {
      log(`[DiscordChannel] Failed to send typing: ${err}`);
    }
  }
}

// Discord channel definition
export const DiscordChannel: ChannelDefinition = {
  name: "discord",
  concurrency: "session",

  async startListener(onEvent: (event: ChannelEvent) => void): Promise<() => void> {
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      throw new Error("DISCORD_BOT_TOKEN not set");
    }

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    // Store client reference for handlers
    (DiscordChannel as any)._client = client;

    client.on("messageCreate", async (msg: Message) => {
      // Skip bot messages (including our own)
      if (msg.author.bot) return;

      const config = loadSecurityConfig();
      const channelId = msg.channel.id;

      // Check if this channel is allowed
      if (config.allowedChannels.length > 0 && !config.allowedChannels.includes(channelId)) {
        return;
      }

      // Skip if this is an echo of our own message
      if (msg.content && isSentMessage(msg.content)) {
        log(`[DiscordChannel] Skipping echo message: ${msg.content.slice(0, 30)}...`);
        return;
      }

      const text = msg.content || "";
      if (!text.trim() && msg.attachments.size === 0) return;

      const from = msg.author.displayName || msg.author.username || "Someone";
      const messageId = msg.id;

      log(`[DiscordChannel] New message from ${from}: ${text.slice(0, 50)}...`);

      // Download attachments if present
      const downloadedFiles: { path: string; name: string; type: string }[] = [];
      for (const [, attachment] of msg.attachments) {
        const timestamp = Date.now();
        const safeFileName = (attachment.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
        const filename = `${timestamp}_${safeFileName}`;
        const filePath = path.join(FILES_DIR, filename);

        try {
          await downloadAttachment(attachment.url, filePath);
          downloadedFiles.push({
            path: filePath,
            name: attachment.name || "file",
            type: attachment.contentType || "application/octet-stream",
          });
          log(`[DiscordChannel] Downloaded attachment: ${attachment.name} -> ${filePath}`);
        } catch (err: any) {
          log(`[DiscordChannel] Failed to download attachment ${attachment.name}: ${err.message}`);
        }
      }

      const sessionKey = `discord-${channelId}`;

      // Build prompt with file paths
      let prompt = `[Discord from ${from} | channel: ${channelId} | msg: ${messageId}]: ${text}`;
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
          channel_id: channelId,
          from,
          text,
          message_id: messageId,
          downloaded_files: downloadedFiles,
          verbosity: "streaming" as Verbosity,
          _client: client,
        },
        message: {
          text,
          from,
          isMessage: true,
        },
      });
    });

    await client.login(botToken);
    log(`[DiscordChannel] Bot logged in as ${client.user?.tag}`);

    // Return stop function
    return () => {
      client.destroy();
      log("[DiscordChannel] Bot stopped");
    };
  },

  createHandler(event: ChannelEvent): ChannelEventHandler {
    const verbosity = event.payload.verbosity || "streaming";
    const discordClient = event.payload._client || (DiscordChannel as any)._client;
    return new DiscordEventHandler(event.payload.channel_id, event.payload.message_id, verbosity, discordClient);
  },

  getSessionKey(payload: any): string {
    return `discord-${payload.channel_id}`;
  },

  getChannelContext(): string {
    return `[Channel: Discord]
- To send files: Use mcp__discord__send_file with the channel ID and file path
- To add reactions: Use mcp__discord__add_reaction with channel ID, message ID, and emoji
- To remove reactions: Use mcp__discord__remove_reaction
- Channel ID for this conversation is in the payload`;
  },
};
