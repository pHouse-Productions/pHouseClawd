import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as https from "https";
import { fileURLToPath } from "url";
import type { Channel, ChannelEvent, StreamHandler, ChannelDefinition, ChannelEventHandler, StreamEvent } from "./types.js";
import { OutputHandler, type Verbosity } from "./output-handler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

const SEND_SCRIPT = path.join(PROJECT_ROOT, "listeners/telegram/send.ts");
const TYPING_SCRIPT = path.join(PROJECT_ROOT, "listeners/telegram/typing.ts");
const ADD_REACTION_SCRIPT = path.join(PROJECT_ROOT, "listeners/telegram/add-reaction.ts");
const REMOVE_REACTION_SCRIPT = path.join(PROJECT_ROOT, "listeners/telegram/remove-reaction.ts");
const HISTORY_SCRIPT = path.join(PROJECT_ROOT, "listeners/telegram/history.js");
const LOGS_DIR = path.join(PROJECT_ROOT, "logs");
const LOG_FILE = path.join(LOGS_DIR, "watcher.log");
const FILES_DIR = path.join(PROJECT_ROOT, "memory/telegram/files");

// Ensure directories exist
if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

function log(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

// Save message to history
function saveMessage(chatId: number, message: { role: string; name?: string; text: string; timestamp: string }) {
  // Use dynamic import or spawn to call the history module
  const historyPath = path.join(PROJECT_ROOT, "listeners/telegram/history.ts");
  // For now, we'll just log - the history module uses ESM and needs proper importing
  log(`[TelegramChannel] Would save to history for chat ${chatId}: ${message.text.slice(0, 50)}...`);
}

// Download file from Telegram
async function downloadFile(bot: Telegraf, fileId: string, destPath: string): Promise<void> {
  const fileLink = await bot.telegram.getFileLink(fileId);
  const url = fileLink.href;

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
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

// Stream handler for Telegram - handles output back to chat
class TelegramStreamHandler implements StreamHandler {
  private chatId: number;
  private messageId: number | null;

  constructor(chatId: number, messageId: number | null) {
    this.chatId = chatId;
    this.messageId = messageId;
  }

  async relayMessage(text: string): Promise<void> {
    if (!text || !text.trim()) return;

    // Telegram has a 4096 character limit - split long messages
    const MAX_LENGTH = 4000;
    const chunks = this.splitMessage(text, MAX_LENGTH);

    log(`[TelegramChannel] Sending ${text.length} chars in ${chunks.length} chunk(s) to ${this.chatId}`);

    // Send chunks with delay to maintain order
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 500));
      try {
        const proc = spawn("npx", ["tsx", SEND_SCRIPT, String(this.chatId), chunks[i]], {
          cwd: PROJECT_ROOT,
          stdio: ["ignore", "ignore", "ignore"],
          detached: true,
        });
        proc.unref();
      } catch (err) {
        log(`[TelegramChannel] Failed to send chunk: ${err}`);
      }
    }
  }

  async startTyping(): Promise<void> {
    try {
      const proc = spawn("npx", ["tsx", TYPING_SCRIPT, String(this.chatId)], {
        cwd: PROJECT_ROOT,
        stdio: ["ignore", "ignore", "ignore"],
        detached: true,
      });
      proc.unref();
    } catch (err) {
      log(`[TelegramChannel] Failed to send typing: ${err}`);
    }
  }

  async startReaction(): Promise<void> {
    if (!this.messageId) return;

    try {
      const proc = spawn("npx", ["tsx", ADD_REACTION_SCRIPT, String(this.chatId), String(this.messageId), "👀"], {
        cwd: PROJECT_ROOT,
        stdio: ["ignore", "ignore", "ignore"],
        detached: true,
      });
      proc.unref();
      log(`[TelegramChannel] Added working reaction to ${this.messageId}`);
    } catch (err) {
      log(`[TelegramChannel] Failed to add reaction: ${err}`);
    }
  }

  async stopReaction(): Promise<void> {
    if (!this.messageId) return;

    try {
      const proc = spawn("npx", ["tsx", REMOVE_REACTION_SCRIPT, String(this.chatId), String(this.messageId)], {
        cwd: PROJECT_ROOT,
        stdio: ["ignore", "ignore", "ignore"],
        detached: true,
      });
      proc.unref();
      log(`[TelegramChannel] Removed working reaction from ${this.messageId}`);
    } catch (err) {
      log(`[TelegramChannel] Failed to remove reaction: ${err}`);
    }
  }

  private splitMessage(message: string, maxLength: number): string[] {
    const chunks: string[] = [];

    if (message.length <= maxLength) {
      chunks.push(message);
    } else {
      let remaining = message;
      while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
          chunks.push(remaining);
          break;
        }

        let splitIndex = remaining.lastIndexOf("\n\n", maxLength);
        if (splitIndex === -1 || splitIndex < maxLength / 2) {
          splitIndex = remaining.lastIndexOf("\n", maxLength);
        }
        if (splitIndex === -1 || splitIndex < maxLength / 2) {
          splitIndex = maxLength;
        }

        chunks.push(remaining.slice(0, splitIndex));
        remaining = remaining.slice(splitIndex).trimStart();
      }
    }

    return chunks;
  }
}

// Legacy handler wrapper for backwards compatibility with watcher
// TODO: Remove after watcher migration
class TelegramEventHandler implements ChannelEventHandler {
  private streamHandler: TelegramStreamHandler;
  private outputHandler: OutputHandler;
  private typingInterval: NodeJS.Timeout | null = null;

  constructor(chatId: number, messageId: number | null, verbosity: Verbosity = "streaming") {
    this.streamHandler = new TelegramStreamHandler(chatId, messageId);
    this.outputHandler = new OutputHandler(
      { verbosity },
      { onSend: (message) => this.streamHandler.relayMessage(message) }
    );
  }

  onWorkStarted(): void {
    // Send initial typing indicator
    this.streamHandler.startTyping();
    this.streamHandler.startReaction();

    // Telegram typing indicator expires after ~5 seconds, so repeat every 4 seconds
    this.typingInterval = setInterval(() => {
      this.streamHandler.startTyping();
    }, 4000);
  }

  onWorkComplete(): void {
    // Stop the typing interval
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
    this.streamHandler.stopReaction();
  }

  onStreamEvent(event: StreamEvent): void {
    this.outputHandler.onStreamEvent(event);
  }

  onComplete(code: number): void {
    // Make sure typing interval is stopped on completion too
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
    this.outputHandler.onComplete(code);
  }
}

// Telegram channel definition
export const TelegramChannel: Channel & ChannelDefinition = {
  name: "telegram",
  concurrency: "session",

  // New interface: listen()
  async listen(onEvent: (event: ChannelEvent) => void): Promise<() => void> {
    return this.startListener(onEvent);
  },

  // Legacy interface: startListener()
  async startListener(onEvent: (event: ChannelEvent) => void): Promise<() => void> {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new Error("TELEGRAM_BOT_TOKEN not set");
    }

    const bot = new Telegraf(botToken);

    bot.on("message", async (ctx) => {
      const chatId = ctx.chat.id;
      const from = ctx.from?.first_name || ctx.from?.username || String(chatId);

      // Handle text messages
      if ("text" in ctx.message) {
        const text = ctx.message.text;
        const messageId = ctx.message.message_id;

        saveMessage(chatId, {
          role: "user",
          name: from,
          text,
          timestamp: new Date().toISOString(),
        });

        onEvent({
          sessionKey: `telegram-${chatId}`,
          prompt: `[Telegram from ${from}]: ${text}`,
          payload: {
            type: "message",
            chat_id: chatId,
            message_id: messageId,
            from,
            text,
          },
          message: {
            text,
            from,
            isMessage: true,
          },
        });

        log(`[TelegramChannel] Received message from ${from}: ${text.slice(0, 50)}...`);
      }

      // Handle photo messages
      if ("photo" in ctx.message) {
        const photo = ctx.message.photo;
        const largestPhoto = photo[photo.length - 1];
        const caption = ctx.message.caption || "";
        const messageId = ctx.message.message_id;
        const timestamp = Date.now();
        const filename = `${chatId}_${timestamp}.jpg`;
        const imagePath = path.join(FILES_DIR, filename);

        try {
          await downloadFile(bot, largestPhoto.file_id, imagePath);

          saveMessage(chatId, {
            role: "user",
            name: from,
            text: caption ? `[Photo] ${caption}` : "[Photo]",
            timestamp: new Date().toISOString(),
          });

          const prompt = caption
            ? `[Telegram photo from ${from}]: ${caption}\n\nIMPORTANT: User sent an image. Use the Read tool to view the image at: ${imagePath}`
            : `[Telegram photo from ${from}]: User sent an image with no caption.\n\nIMPORTANT: Use the Read tool to view the image at: ${imagePath}`;

          onEvent({
            sessionKey: `telegram-${chatId}`,
            prompt,
            payload: {
              type: "photo",
              chat_id: chatId,
              message_id: messageId,
              from,
              caption,
              image_path: imagePath,
            },
            message: {
              text: caption,
              from,
              isMessage: true,
            },
          });

          log(`[TelegramChannel] Received photo from ${from}`);
        } catch (err) {
          log(`[TelegramChannel] Failed to download photo: ${err}`);
        }
      }

      // Handle document messages
      if ("document" in ctx.message) {
        const doc = ctx.message.document;
        const caption = ctx.message.caption || "";
        const messageId = ctx.message.message_id;
        const timestamp = Date.now();
        const originalName = doc.file_name || "document";
        const filename = `${chatId}_${timestamp}_${originalName}`;
        const filePath = path.join(FILES_DIR, filename);

        try {
          await downloadFile(bot, doc.file_id, filePath);

          saveMessage(chatId, {
            role: "user",
            name: from,
            text: caption ? `[Document: ${originalName}] ${caption}` : `[Document: ${originalName}]`,
            timestamp: new Date().toISOString(),
          });

          const prompt = caption
            ? `[Telegram document from ${from}]: ${caption}\n\nFile: ${originalName} (${doc.mime_type || "unknown"})\n\nIMPORTANT: The file has been saved to: ${filePath}`
            : `[Telegram document from ${from}]: User sent a file.\n\nFile: ${originalName} (${doc.mime_type || "unknown"})\n\nIMPORTANT: The file has been saved to: ${filePath}`;

          onEvent({
            sessionKey: `telegram-${chatId}`,
            prompt,
            payload: {
              type: "document",
              chat_id: chatId,
              message_id: messageId,
              from,
              caption,
              file_path: filePath,
              file_name: originalName,
              mime_type: doc.mime_type || "application/octet-stream",
            },
            message: {
              text: caption,
              from,
              isMessage: true,
            },
          });

          log(`[TelegramChannel] Received document from ${from}: ${originalName}`);
        } catch (err) {
          log(`[TelegramChannel] Failed to download document: ${err}`);
        }
      }
    });

    // Start bot without awaiting - launch() returns a Promise that only resolves
    // when the bot is stopped, so we'd block forever if we awaited it
    bot.launch().catch((err) => {
      log(`[TelegramChannel] Bot error: ${err}`);
    });
    log("[TelegramChannel] Bot started");

    // Return stop function
    return () => {
      bot.stop("SIGTERM");
      log("[TelegramChannel] Bot stopped");
    };
  },

  // New interface: createStreamHandler()
  createStreamHandler(event: ChannelEvent): StreamHandler {
    const messageId = event.payload.message_id || null;
    return new TelegramStreamHandler(event.payload.chat_id, messageId);
  },

  // Legacy interface: createHandler()
  createHandler(event: ChannelEvent): ChannelEventHandler {
    const verbosity = event.payload.verbosity || "streaming";
    const messageId = event.payload.message_id || null;
    return new TelegramEventHandler(event.payload.chat_id, messageId, verbosity);
  },

  getSessionKey(payload: any): string {
    return `telegram-${payload.chat_id}`;
  },

  // New interface: getCustomPrompt()
  getCustomPrompt(): string {
    return this.getChannelContext!();
  },

  // Legacy interface: getChannelContext()
  getChannelContext(): string {
    return `[Channel: Telegram]
- To send images: Use mcp__telegram__send_photo (renders inline in chat)
- To send files: Use mcp__telegram__send_document
- Chat ID for this conversation is in the payload`;
  },
};
