import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as https from "https";
import { fileURLToPath } from "url";
import type { ChannelDefinition, ChannelEvent, ChannelEventHandler, StreamEvent } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

const SEND_SCRIPT = path.join(PROJECT_ROOT, "listeners/telegram/send.ts");
const TYPING_SCRIPT = path.join(PROJECT_ROOT, "listeners/telegram/typing.ts");
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

// Verbosity levels
type Verbosity = "streaming" | "progress" | "final";

const FLUSH_INTERVAL_MS = 2000;
const MIN_CHARS_TO_FLUSH = 50;

// Handler for a single Telegram event
class TelegramEventHandler implements ChannelEventHandler {
  private chatId: number;
  private verbosity: Verbosity;
  private textBuffer: string = "";
  private lastFlush: number = Date.now();
  private flushTimer: NodeJS.Timeout | null = null;
  private typingInterval: NodeJS.Timeout | null = null;
  private isComplete: boolean = false;
  private restartTypingTimer: NodeJS.Timeout | null = null;

  constructor(chatId: number, verbosity: Verbosity = "streaming") {
    this.chatId = chatId;
    this.verbosity = verbosity;
    this.startTyping();
  }

  onStreamEvent(event: StreamEvent): void {
    // Check for result event - this means Claude is done
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

    if (this.restartTypingTimer) {
      clearTimeout(this.restartTypingTimer);
      this.restartTypingTimer = null;
    }

    this.stopTyping();

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.textBuffer.trim()) {
      this.sendMessage(this.textBuffer.trim());
      this.textBuffer = "";
    }

    log(`[TelegramChannel] Complete for chat ${this.chatId}, code ${code}`);
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
      this.stopTyping();
      this.sendMessage(text);
      this.textBuffer = "";
      this.lastFlush = Date.now();

      if (!this.isComplete) {
        this.restartTypingTimer = setTimeout(() => {
          if (!this.isComplete) {
            this.startTyping();
          }
        }, 500);
      }
    }
  }

  private sendMessage(message: string): void {
    if (!message || !message.trim()) return;

    try {
      const proc = spawn("npx", ["tsx", SEND_SCRIPT, String(this.chatId), message], {
        cwd: PROJECT_ROOT,
        stdio: ["ignore", "ignore", "ignore"],
        detached: true,
      });
      proc.unref();
      log(`[TelegramChannel] Sent to ${this.chatId}: ${message.slice(0, 100)}${message.length > 100 ? "..." : ""}`);
    } catch (err) {
      log(`[TelegramChannel] Failed to send: ${err}`);
    }
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

  private startTyping(): void {
    if (this.typingInterval) return;
    this.sendTypingIndicator();
    this.typingInterval = setInterval(() => this.sendTypingIndicator(), 4000);
  }

  private stopTyping(): void {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
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
            from,
            text,
            verbosity: "streaming" as Verbosity,
          },
        });

        log(`[TelegramChannel] Received message from ${from}: ${text.slice(0, 50)}...`);
      }

      // Handle photo messages
      if ("photo" in ctx.message) {
        const photo = ctx.message.photo;
        const largestPhoto = photo[photo.length - 1];
        const caption = ctx.message.caption || "";
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
              from,
              caption,
              image_path: imagePath,
              verbosity: "streaming" as Verbosity,
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
              from,
              caption,
              file_path: filePath,
              file_name: originalName,
              mime_type: doc.mime_type || "application/octet-stream",
              verbosity: "streaming" as Verbosity,
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
    return new TelegramEventHandler(event.payload.chat_id, verbosity);
  },
};
