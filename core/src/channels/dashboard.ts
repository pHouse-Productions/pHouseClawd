import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { ChannelDefinition, ChannelEvent, ChannelEventHandler, StreamEvent } from "./types.js";
import type { Verbosity } from "./output-handler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

const LOGS_DIR = path.join(PROJECT_ROOT, "logs");
const LOG_FILE = path.join(LOGS_DIR, "watcher.log");
const MEMORY_DIR = path.join(PROJECT_ROOT, "memory");
const QUEUE_FILE = path.join(MEMORY_DIR, "dashboard-queue.json");
const CHAT_FILE = path.join(MEMORY_DIR, "dashboard-chat.jsonl");

// Ensure directories exist
if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

function log(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

interface Attachment {
  type: "image" | "file";
  path: string;
  name: string;
  mimeType?: string;
}

// Queue message interface - what the dashboard API writes
interface QueuedMessage {
  id: string;
  userId: string;
  content: string;
  timestamp: string;
  attachments?: Attachment[];
}

interface QueueData {
  messages: QueuedMessage[];
}

// JSONL event types - same structure as job logs for consistency
interface BaseEvent {
  ts: string;  // ISO timestamp
  type: string;
}

interface UserEvent extends BaseEvent {
  type: "user";
  content: string;
  attachments?: Attachment[];
  messageId: string;
}

interface AssistantEvent extends BaseEvent {
  type: "assistant";
  content: string;
  status: "streaming" | "complete" | "error";
  messageId: string;
}

interface ToolEvent extends BaseEvent {
  type: "tool";
  name: string;
  input?: any;
}

type ChatEvent = UserEvent | AssistantEvent | ToolEvent;

function loadQueueData(): QueueData {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf-8"));
    }
  } catch (err) {
    log(`[DashboardChannel] Failed to load queue: ${err}`);
  }
  return { messages: [] };
}

function saveQueueData(data: QueueData): void {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2));
}

function appendEvent(event: ChatEvent): void {
  const line = JSON.stringify(event) + "\n";
  fs.appendFileSync(CHAT_FILE, line);
}

// Handler for a single dashboard event
class DashboardEventHandler implements ChannelEventHandler {
  private currentMessageId: string;
  private turns: string[] = [];  // Each turn's final text
  private currentTurnText: string = "";  // Current turn's accumulated text
  private isComplete: boolean = false;
  private receivedDeltaEvents: boolean = false;

  constructor(messageId: string) {
    this.currentMessageId = messageId;
  }

  private getFullText(): string {
    const parts = [...this.turns];
    if (this.currentTurnText.trim()) {
      parts.push(this.currentTurnText);
    }
    return parts.join("\n\n");
  }

  onStreamEvent(event: StreamEvent): void {
    if (this.isComplete) return;

    // Detect turn boundary: user events indicate tool results, meaning a new assistant turn is coming
    // In session mode, the sequence is: assistant (turn 1) -> user (tool results) -> assistant (turn 2)
    if (event.type === "user") {
      if (this.currentTurnText.trim()) {
        this.turns.push(this.currentTurnText.trim());
        this.currentTurnText = "";
      }
      return; // Don't process user events further
    }

    // Detect new turn: message_start signals a turn boundary
    if (event.type === "message_start") {
      if (this.currentTurnText.trim()) {
        this.turns.push(this.currentTurnText.trim());
        this.currentTurnText = "";
      }
    }

    // Detect new turn: when we see a tool_use, the current turn ends (streaming mode)
    if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
      // Finalize current turn if there's text
      if (this.currentTurnText.trim()) {
        this.turns.push(this.currentTurnText.trim());
        this.currentTurnText = "";
      }

      appendEvent({
        ts: new Date().toISOString(),
        type: "tool",
        name: event.content_block.name,
        input: event.content_block.input,
      });
      return;
    }

    // Session mode: detect tool calls from assistant events content array
    if (event.type === "assistant" && event.message?.content) {
      const toolUses = event.message.content.filter((c: any) => c.type === "tool_use");
      for (const tool of toolUses) {
        appendEvent({
          ts: new Date().toISOString(),
          type: "tool",
          name: tool.name,
          input: tool.input,
        });
      }
    }

    // Extract text from stream events
    const text = this.extractText(event);
    if (text !== null) {
      // Write streaming update with full accumulated text
      appendEvent({
        ts: new Date().toISOString(),
        type: "assistant",
        content: this.getFullText(),
        status: "streaming",
        messageId: this.currentMessageId,
      });
    }

    // Check for result event - this means Claude is done
    if (event.type === "result") {
      this.onComplete(event.subtype === "success" ? 0 : 1);
    }
  }

  onComplete(code: number): void {
    if (this.isComplete) return;
    this.isComplete = true;

    const status = code === 0 ? "complete" : "error";
    const fullText = this.getFullText();

    // Only write final event if we have content
    if (fullText.trim()) {
      appendEvent({
        ts: new Date().toISOString(),
        type: "assistant",
        content: fullText,
        status,
        messageId: this.currentMessageId,
      });
    }

    log(`[DashboardChannel] Complete (status: ${status})`);
  }

  private extractText(event: StreamEvent): string | null {
    // Streaming mode: content_block_delta events (incremental deltas)
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      this.receivedDeltaEvents = true;
      this.currentTurnText += event.delta.text;
      return event.delta.text;
    }

    // Session mode: assistant events contain full message content for current turn
    // These are cumulative WITHIN a turn, but reset between turns
    if (event.type === "assistant" && !this.receivedDeltaEvents && event.message?.content) {
      const textParts = event.message.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text);
      if (textParts.length > 0) {
        const fullTurnText = textParts.join("");

        // Ignore empty text events (these occur during tool execution)
        if (!fullTurnText) {
          return null;
        }

        // Only update if we have new content (cumulative within a turn)
        if (fullTurnText.length > this.currentTurnText.length) {
          this.currentTurnText = fullTurnText;
          return fullTurnText;  // Return non-null to trigger update
        }
      }
    }

    return null;
  }
}

// Dashboard channel definition
export const DashboardChannel: ChannelDefinition = {
  name: "dashboard",
  concurrency: "session",

  async startListener(onEvent: (event: ChannelEvent) => void): Promise<() => void> {
    let running = true;

    const poll = async () => {
      while (running) {
        try {
          const queueData = loadQueueData();

          if (queueData.messages.length > 0) {
            // Process the first message in the queue
            const msg = queueData.messages.shift()!;
            saveQueueData(queueData);

            log(`[DashboardChannel] Processing message: ${msg.content.slice(0, 50)}...`);

            // Write user event to JSONL
            appendEvent({
              ts: new Date().toISOString(),
              type: "user",
              content: msg.content,
              attachments: msg.attachments,
              messageId: msg.id,
            });

            // Build prompt with attachment instructions
            let prompt = `[Dashboard Chat from User]: ${msg.content}`;
            if (msg.attachments && msg.attachments.length > 0) {
              const attachmentLines = msg.attachments.map(att => {
                if (att.type === "image") {
                  return `- Image: ${att.name} -> Use Read tool to view: ${att.path}`;
                } else {
                  return `- File: ${att.name} (${att.mimeType || "unknown type"}) -> Saved at: ${att.path}`;
                }
              });
              prompt += `\n\nUser attached ${msg.attachments.length} file(s):\n${attachmentLines.join("\n")}`;
            }

            // Generate a new message ID for the assistant response
            const assistantMessageId = crypto.randomUUID();

            onEvent({
              sessionKey: `dashboard-${msg.userId}`,
              prompt,
              payload: {
                type: msg.attachments && msg.attachments.length > 0 ? "message_with_attachments" : "message",
                userId: msg.userId,
                messageId: msg.id,
                assistantMessageId,
                content: msg.content,
                attachments: msg.attachments,
                verbosity: "streaming" as Verbosity,
              },
              message: {
                text: msg.content,
                from: msg.userId,
                isMessage: true,
              },
            });
          }
        } catch (err) {
          log(`[DashboardChannel] Poll error: ${err}`);
        }

        // Poll every 500ms
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    };

    // Start polling
    poll();
    log("[DashboardChannel] Listener started");

    // Return stop function
    return () => {
      running = false;
      log("[DashboardChannel] Listener stopped");
    };
  },

  createHandler(event: ChannelEvent): ChannelEventHandler {
    return new DashboardEventHandler(event.payload.assistantMessageId);
  },

  getSessionKey(payload: any): string {
    return `dashboard-${payload.userId}`;
  },

  getChannelContext(): string {
    return `[Channel: Dashboard]
- This is a web-based chat from the dashboard
- Respond directly - your text output will be displayed to the user
- No need to use MCP tools for basic replies
- If user sends images, use the Read tool to view them at the provided path
- To send images/files back: Save to /home/ubuntu/pHouseClawd/memory/dashboard/files/ and include the path in your response - the UI will render images inline`;
  },
};
