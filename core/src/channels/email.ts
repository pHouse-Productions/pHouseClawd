import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import type { Channel, StreamEvent } from "./index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

const LOGS_DIR = path.join(PROJECT_ROOT, "logs");
const LOG_FILE = path.join(LOGS_DIR, "watcher.log");

function log(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

export interface EmailConfig {
  replyTo: string;
  subject: string;
  threadId?: string;
  messageId?: string;
}

export class EmailChannel implements Channel {
  private config: EmailConfig;
  private textBuffer: string = "";
  private isComplete: boolean = false;

  constructor(config: EmailConfig) {
    this.config = config;
  }

  onStreamEvent(event: StreamEvent): void {
    // Check for result event - this means Claude is done
    if (event.type === "result") {
      this.onComplete(event.subtype === "success" ? 0 : 1);
      return;
    }

    // Email uses "final" verbosity - just accumulate text
    const text = this.extractText(event);
    if (text) {
      this.textBuffer += text;
    }
  }

  onComplete(code: number): void {
    // Guard against being called multiple times
    if (this.isComplete) return;
    this.isComplete = true;

    // Send the accumulated response as an email reply
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
