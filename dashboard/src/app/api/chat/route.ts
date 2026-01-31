import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getLocalTimestamp } from "@/lib/utils";

function getProjectRoot(): string {
  return path.resolve(process.cwd(), "..");
}

const MEMORY_DIR = path.join(getProjectRoot(), "memory");
const QUEUE_FILE = path.join(MEMORY_DIR, "dashboard-queue.json");
const CHAT_FILE = path.join(MEMORY_DIR, "dashboard-chat.jsonl");
const TYPING_LOCK = path.join(MEMORY_DIR, "dashboard-typing.lock");
const FILES_DIR = path.join(MEMORY_DIR, "dashboard", "files");
const LOGS_DIR = path.join(getProjectRoot(), "logs");
const LOG_FILE = path.join(LOGS_DIR, "watcher.log");
const SHORT_TERM_MEMORY_FILE = path.join(MEMORY_DIR, "short-term", "buffer.txt");

// Ensure files directory exists
fs.mkdir(FILES_DIR, { recursive: true }).catch(() => {});

interface Attachment {
  type: "image" | "file";
  path: string;
  name: string;
  mimeType?: string;
}

// JSONL event types - mirrors what the watcher writes
interface BaseEvent {
  ts: string;
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

// Message type for frontend consumption
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  status?: "pending" | "streaming" | "complete" | "error";
  attachments?: Attachment[];
}

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

function log(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [dashboard-chat] ${message}\n`;
  fs.appendFile(LOG_FILE, line).catch(() => {});
}

function logToShortTermMemory(direction: "in" | "out", content: string): void {
  const timestamp = getLocalTimestamp();
  const line = `[${timestamp}] [dashboard] [${direction}] ${content}\n`;
  fs.appendFile(SHORT_TERM_MEMORY_FILE, line).catch(() => {});
}

async function loadQueueData(): Promise<QueueData> {
  try {
    const content = await fs.readFile(QUEUE_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return { messages: [] };
  }
}

async function saveQueueData(data: QueueData): Promise<void> {
  const dir = path.dirname(QUEUE_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(QUEUE_FILE, JSON.stringify(data, null, 2));
}

// Read JSONL file and parse events
async function readChatEvents(): Promise<ChatEvent[]> {
  try {
    const content = await fs.readFile(CHAT_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(line => line.trim());
    return lines.map(line => JSON.parse(line) as ChatEvent);
  } catch {
    return [];
  }
}

// Convert events to messages for frontend
// Check if typing lock exists
async function isTyping(): Promise<boolean> {
  try {
    await fs.access(TYPING_LOCK);
    return true;
  } catch {
    return false;
  }
}

// Create typing lock
async function setTyping(): Promise<void> {
  try {
    await fs.writeFile(TYPING_LOCK, new Date().toISOString());
  } catch (err) {
    log(`Failed to create typing lock: ${err}`);
  }
}

// Remove typing lock
async function clearTyping(): Promise<void> {
  try {
    await fs.unlink(TYPING_LOCK);
  } catch {
    // File doesn't exist, that's fine
  }
}

function eventsToMessages(events: ChatEvent[]): Message[] {
  const messages: Message[] = [];
  const assistantMessages = new Map<string, Message>();

  for (const event of events) {
    if (event.type === "user") {
      messages.push({
        id: event.messageId,
        role: "user",
        content: event.content,
        timestamp: event.ts,
        status: "complete",
        attachments: event.attachments,
      });
    } else if (event.type === "assistant") {
      // For assistant messages, we might get multiple events (streaming updates)
      // Always use the latest one for each messageId
      assistantMessages.set(event.messageId, {
        id: event.messageId,
        role: "assistant",
        content: event.content,
        timestamp: event.ts,
        status: event.status,
      });
    }
    // Tool events are not rendered as messages for now
  }

  // Merge assistant messages into the messages array in timestamp order
  const allMessages = [...messages, ...assistantMessages.values()];
  allMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return allMessages;
}

// GET - Retrieve chat history
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const afterTs = searchParams.get("after");
  const beforeTs = searchParams.get("before");
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 50;

  try {
    const events = await readChatEvents();
    const messages = eventsToMessages(events);

    // Check typing state
    let typing = await isTyping();

    // If typing but last message is a complete assistant message, clear the lock
    if (typing && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === "assistant" && lastMsg.status === "complete") {
        await clearTyping();
        typing = false;
      }
    }

    if (afterTs) {
      // Return only messages after the specified timestamp (for polling)
      const afterTime = new Date(afterTs).getTime();
      const newMessages = messages.filter(m => new Date(m.timestamp).getTime() > afterTime);

      // Also include any streaming/pending messages that might have updated
      const pendingMessages = messages.filter(m =>
        (m.status === "streaming" || m.status === "pending") &&
        new Date(m.timestamp).getTime() >= afterTime
      );

      // Merge and dedupe
      const allNew = [...newMessages];
      for (const pm of pendingMessages) {
        if (!allNew.find(m => m.id === pm.id)) {
          allNew.push(pm);
        }
      }

      return NextResponse.json({ messages: allNew, isTyping: typing });
    }

    if (beforeTs) {
      // Return messages before the specified timestamp (for loading older)
      const beforeTime = new Date(beforeTs).getTime();
      const olderMessages = messages.filter(m => new Date(m.timestamp).getTime() < beforeTime);
      const startIdx = Math.max(0, olderMessages.length - limit);
      return NextResponse.json({
        messages: olderMessages.slice(startIdx),
        hasMore: startIdx > 0,
        isTyping: typing,
      });
    }

    // Default: return last N messages
    if (messages.length > limit) {
      const startIdx = messages.length - limit;
      return NextResponse.json({
        messages: messages.slice(startIdx),
        hasMore: startIdx > 0,
        isTyping: typing,
      });
    }

    return NextResponse.json({
      messages,
      hasMore: false,
      isTyping: typing,
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to load chat history", details: String(err) }, { status: 500 });
  }
}

// POST - Send a new message (adds to queue for watcher to process)
export async function POST(request: NextRequest) {
  try {
    let message: string = "";
    const attachments: Attachment[] = [];

    const contentType = request.headers.get("content-type") || "";
    log(`POST request - Content-Type: ${contentType}`);

    if (contentType.includes("multipart/form-data")) {
      log(`Parsing as multipart/form-data`);
      const formData = await request.formData();
      message = (formData.get("message") as string) || "";

      const files = formData.getAll("files") as File[];
      const timestamp = Date.now();

      for (const file of files) {
        if (file.size > 0) {
          const ext = file.name.split(".").pop() || "bin";
          const filename = `${timestamp}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
          const filePath = path.join(FILES_DIR, filename);

          const buffer = Buffer.from(await file.arrayBuffer());
          await fs.writeFile(filePath, buffer);

          attachments.push({
            type: file.type.startsWith("image/") ? "image" : "file",
            path: filePath,
            name: file.name,
            mimeType: file.type,
          });

          log(`Saved attachment: ${file.name} -> ${filePath}`);
        }
      }
    } else {
      const body = await request.json();
      message = body.message || "";
    }

    if (!message && attachments.length === 0) {
      return NextResponse.json({ error: "Message or attachment is required" }, { status: 400 });
    }

    const userMessageId = crypto.randomUUID();

    // Log incoming message to short-term memory
    const attachmentNote = attachments.length > 0
      ? ` [${attachments.length} attachment(s): ${attachments.map(a => a.name).join(", ")}]`
      : "";
    logToShortTermMemory("in", `User: ${message}${attachmentNote}`);

    // Add to queue for watcher to process
    // The watcher will write the user event to JSONL when it processes
    const queueData = await loadQueueData();
    queueData.messages.push({
      id: userMessageId,
      userId: "default",
      content: message,
      timestamp: new Date().toISOString(),
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    await saveQueueData(queueData);

    // Set typing indicator
    await setTyping();

    log(`Queued message for watcher: ${message.slice(0, 100)}...${attachments.length > 0 ? ` (${attachments.length} files)` : ""}`);

    return NextResponse.json({
      success: true,
      userMessageId,
      timestamp: new Date().toISOString(),
      attachments: attachments.length > 0 ? attachments : undefined,
    });
  } catch (err) {
    log(`POST error: ${err}`);
    if (err instanceof Error) {
      log(`POST error stack: ${err.stack}`);
    }
    return NextResponse.json({ error: "Failed to send message", details: String(err) }, { status: 500 });
  }
}

// DELETE - Clear chat history
export async function DELETE() {
  try {
    // Truncate the JSONL file
    await fs.writeFile(CHAT_FILE, "");
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: "Failed to clear chat", details: String(err) }, { status: 500 });
  }
}
