import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import type { Channel, StreamEvent } from "./index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

const SEND_SCRIPT = path.join(PROJECT_ROOT, "listeners/telegram/send.ts");
const TYPING_SCRIPT = path.join(PROJECT_ROOT, "listeners/telegram/typing.ts");
const LOGS_DIR = path.join(PROJECT_ROOT, "logs");
const LOG_FILE = path.join(LOGS_DIR, "watcher.log");

function log(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

// Verbosity levels for message streaming
type Verbosity = "streaming" | "progress" | "final";

const FLUSH_INTERVAL_MS = 2000;
const MIN_CHARS_TO_FLUSH = 50;

export class TelegramChannel implements Channel {
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
    // Start typing immediately
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
    // Guard against being called multiple times
    if (this.isComplete) return;
    this.isComplete = true;

    // Clear any pending restart timer
    if (this.restartTypingTimer) {
      clearTimeout(this.restartTypingTimer);
      this.restartTypingTimer = null;
    }

    // Stop typing
    this.stopTyping();

    // Clear flush timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush any remaining text
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
      // Stop typing before sending message
      this.stopTyping();

      this.sendMessage(text);
      this.textBuffer = "";
      this.lastFlush = Date.now();

      // Restart typing after 500ms if not complete
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
    if (this.typingInterval) return; // Already typing

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
