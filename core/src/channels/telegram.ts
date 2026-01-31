import { Telegraf } from "telegraf";
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

// Handler for a single Telegram event
class TelegramEventHandler implements ChannelEventHandler {
  private chatId: number;
  private messageId: number | null;
  private outputHandler: OutputHandler;
  private hasAddedReaction = false;

  constructor(chatId: number, messageId: number | null, verbosity: Verbosity = "streaming") {
    this.chatId = chatId;
    this.messageId = messageId;

    this.outputHandler = new OutputHandler(
      { verbosity },
      {
        onSend: (message) => this.sendMessage(message),
        // Telegram has both typing indicator AND reactions - we use both like Discord
        onWorkStarted: () => {
          this.sendTypingIndicator();
          this.addWorkingReaction();
        },
        onWorkComplete: () => this.removeWorkingReaction(),
      }
    );
  }

  onStreamEvent(event: StreamEvent): void {
    this.outputHandler.onStreamEvent(event);
  }

  onComplete(code: number): void {
    this.outputHandler.onComplete(code);
    log(`[TelegramChannel] Complete for chat ${this.chatId}, code ${code}`);
  }

  private sendMessage(message: string): void {
    if (!message || !message.trim()) return;

    // Telegram has a 4096 character limit - split long messages
    const MAX_LENGTH = 4000; // Leave some margin
    const chunks = this.splitMessage(message, MAX_LENGTH);

    log(`[TelegramChannel] Sending ${message.length} chars in ${chunks.length} chunk(s) to ${this.chatId}`);

    // Send chunks with delay to maintain order
    chunks.forEach((chunk, index) => {
      setTimeout(() => {
        try {
          const proc = spawn("npx", ["tsx", SEND_SCRIPT, String(this.chatId), chunk], {
            cwd: PROJECT_ROOT,
            stdio: ["ignore", "ignore", "ignore"],
            detached: true,
          });
          proc.unref();
        } catch (err) {
          log(`[TelegramChannel] Failed to send chunk: ${err}`);
        }
      }, index * 500); // 500ms between each chunk
    });
  }

  private splitMessage(message: string, maxLength: number): string[] {
    const chunks: string[] = [];

    if (message.length <= maxLength) {
      chunks.push(message);
    } else {
      // Split on paragraph breaks first, then by length
      let remaining = message;
      while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
          chunks.push(remaining);
          break;
        }

        // Try to split at a paragraph break
        let splitIndex = remaining.lastIndexOf("\n\n", maxLength);
        if (splitIndex === -1 || splitIndex < maxLength / 2) {
          // No good paragraph break, try single newline
          splitIndex = remaining.lastIndexOf("\n", maxLength);
        }
        if (splitIndex === -1 || splitIndex < maxLength / 2) {
          // No good newline, just split at max length
          splitIndex = maxLength;
        }

        chunks.push(remaining.slice(0, splitIndex));
        remaining = remaining.slice(splitIndex).trimStart();
      }
    }

    return chunks;
  }

  private sendTypingIndicator(): void {
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

  private addWorkingReaction(): void {
    // Only add reaction once, and only if we have a message ID
    if (this.hasAddedReaction || !this.messageId) return;

    try {
      const proc = spawn("npx", ["tsx", ADD_REACTION_SCRIPT, String(this.chatId), String(this.messageId), "👀"], {
        cwd: PROJECT_ROOT,
        stdio: ["ignore", "ignore", "ignore"],
        detached: true,
      });
      proc.unref();
      this.hasAddedReaction = true;
      log(`[TelegramChannel] Added working reaction to ${this.messageId}`);
    } catch (err) {
      log(`[TelegramChannel] Failed to add reaction: ${err}`);
    }
  }

  private removeWorkingReaction(): void {
    if (!this.hasAddedReaction || !this.messageId) return;

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
}

// Telegram channel definition
export const TelegramChannel: ChannelDefinition = {
  name: "telegram",
  concurrency: "session",

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
            verbosity: "streaming" as Verbosity,
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
              verbosity: "streaming" as Verbosity,
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
              verbosity: "streaming" as Verbosity,
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

  createHandler(event: ChannelEvent): ChannelEventHandler {
    const verbosity = event.payload.verbosity || "streaming";
    const messageId = event.payload.message_id || null;
    return new TelegramEventHandler(event.payload.chat_id, messageId, verbosity);
  },

  getSessionKey(payload: any): string {
    return `telegram-${payload.chat_id}`;
  },

  getChannelContext(): string {
    return `[Channel: Telegram]
- To send images: Use mcp__telegram__send_photo (renders inline in chat)
- To send files: Use mcp__telegram__send_document
- Chat ID for this conversation is in the payload`;
  },
};
