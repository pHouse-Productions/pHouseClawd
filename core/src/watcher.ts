import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import cron from "node-cron";
import { getPendingEvents, markProcessed, Event, pushEvent } from "./events.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

// Generate a deterministic UUID v5 from a namespace + name
const NAMESPACE_UUID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // DNS namespace
function generateSessionId(name: string): string {
  const hash = crypto.createHash("sha1");
  // Parse namespace UUID to bytes
  const namespaceBytes = Buffer.from(NAMESPACE_UUID.replace(/-/g, ""), "hex");
  hash.update(namespaceBytes);
  hash.update(name);
  const digest = hash.digest();

  // Set version (5) and variant bits
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;

  // Format as UUID
  const hex = digest.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const PENDING_DIR = path.join(PROJECT_ROOT, "events/pending");
const SEND_SCRIPT = path.join(PROJECT_ROOT, "integrations/telegram/src/send.ts");
const LOGS_DIR = path.join(PROJECT_ROOT, "logs");
const LOG_FILE = path.join(LOGS_DIR, "watcher.log");  // Watcher operational logs
const STREAM_LOG = path.join(LOGS_DIR, "claude-stream.jsonl");  // Raw Claude stream events
const SESSIONS_FILE = path.join(LOGS_DIR, "sessions.json");
const CRON_CONFIG_FILE = path.join(PROJECT_ROOT, "config/cron.json");
const POLL_INTERVAL = 1000; // Check every second

// Cron job interface
interface CronJob {
  id: string;
  enabled: boolean;
  schedule: string;
  description: string;
  prompt: string;
  run_once?: boolean;
  run_at?: string;
}

interface CronConfig {
  jobs: CronJob[];
}

// Track active cron tasks and one-off timeouts
const activeCronTasks: Map<string, cron.ScheduledTask> = new Map();
const activeTimeouts: Map<string, NodeJS.Timeout> = new Map();

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Track known sessions and their generations
interface SessionData {
  known: string[];
  generations: Record<string, number>;  // sessionKey -> generation counter
}

function loadSessionData(): SessionData {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8"));
      // Handle legacy format (just an array of session IDs)
      if (Array.isArray(data)) {
        return { known: data, generations: {} };
      }
      return data;
    }
  } catch {}
  return { known: [], generations: {} };
}

function saveSessionData(data: SessionData): void {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
}

function getKnownSessions(): Set<string> {
  return new Set(loadSessionData().known);
}

function markSessionKnown(sessionId: string): void {
  const data = loadSessionData();
  if (!data.known.includes(sessionId)) {
    data.known.push(sessionId);
  }
  saveSessionData(data);
}

function clearSession(sessionKey: string): void {
  const data = loadSessionData();
  // Get the current generation's session ID before incrementing
  const currentGen = data.generations[sessionKey] || 0;
  const oldSessionId = generateSessionId(`${sessionKey}-gen${currentGen}`);
  // Remove old session ID from known list
  data.known = data.known.filter(id => id !== oldSessionId);
  // Increment generation so next session gets a new ID
  data.generations[sessionKey] = currentGen + 1;
  saveSessionData(data);
}

function getSessionGeneration(sessionKey: string): number {
  return loadSessionData().generations[sessionKey] || 0;
}

// Lock to prevent concurrent processing
let isProcessing = false;
let pendingPoll = false;

function log(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
  process.stdout.write(line);
}

// Log a raw stream event to JSONL (adds timestamp wrapper)
function logStreamEvent(event: any) {
  const entry = {
    ts: new Date().toISOString(),
    ...event
  };
  fs.appendFileSync(STREAM_LOG, JSON.stringify(entry) + "\n");
}

// Verbosity levels for chat surfaces
type Verbosity = "streaming" | "progress" | "final";

// Message buffer for batching relay messages
interface RelayBuffer {
  chatId: number | null;  // null for email
  verbosity: Verbosity;
  textBuffer: string;
  lastFlush: number;
  flushTimer: NodeJS.Timeout | null;
  // Email-specific fields
  email?: {
    replyTo: string;
    subject: string;
    threadId?: string;
    messageId?: string;  // Original email's Message-ID for In-Reply-To header
  };
}

const FLUSH_INTERVAL_MS = 2000; // Batch messages every 2 seconds
const MIN_CHARS_TO_FLUSH = 50; // Or flush when we have this many chars


// Send message to Telegram (fire and forget)
async function sendToTelegram(chatId: number, message: string): Promise<void> {
  if (!message || !message.trim()) return;

  try {
    const proc = spawn("npx", ["tsx", SEND_SCRIPT, String(chatId), message], {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
    });
    proc.unref();
    log(`[Relay] Sent to Telegram ${chatId}: ${message.slice(0, 100)}${message.length > 100 ? '...' : ''}`);
  } catch (err) {
    log(`[Relay] Failed to send to Telegram: ${err}`);
  }
}

// Send email reply via Gmail MCP script
async function sendEmailReply(to: string, subject: string, body: string, threadId?: string, messageId?: string): Promise<void> {
  if (!body || !body.trim()) return;

  // Ensure subject has Re: prefix
  const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;

  // Build args - threadId and messageId are optional
  const args = ["tsx", path.join(PROJECT_ROOT, "integrations/gmail/src/send-reply.ts"), to, replySubject, body];
  args.push(threadId || "");  // 4th arg: threadId (empty string if none)
  args.push(messageId || ""); // 5th arg: messageId for In-Reply-To header

  try {
    const proc = spawn("npx", args, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    proc.unref();
    log(`[Relay] Sent email reply to ${to} (thread: ${threadId || 'new'}, inReplyTo: ${messageId || 'none'}): ${body.slice(0, 100)}${body.length > 100 ? '...' : ''}`);
  } catch (err) {
    log(`[Relay] Failed to send email reply: ${err}`);
  }
}

// Flush buffered text to chat surface
function flushBuffer(buffer: RelayBuffer): void {
  if (buffer.flushTimer) {
    clearTimeout(buffer.flushTimer);
    buffer.flushTimer = null;
  }

  const text = buffer.textBuffer.trim();
  if (text) {
    sendToTelegram(buffer.chatId, text);
    buffer.textBuffer = "";
  }
  buffer.lastFlush = Date.now();
}

// Add text to buffer, flushing if needed
function bufferText(buffer: RelayBuffer, text: string): void {
  buffer.textBuffer += text;

  // Flush if we have enough text or it's been a while
  const timeSinceFlush = Date.now() - buffer.lastFlush;
  if (buffer.textBuffer.length >= MIN_CHARS_TO_FLUSH || timeSinceFlush > FLUSH_INTERVAL_MS) {
    flushBuffer(buffer);
  } else if (!buffer.flushTimer) {
    // Set a timer to flush later
    buffer.flushTimer = setTimeout(() => flushBuffer(buffer), FLUSH_INTERVAL_MS);
  }
}

// Create a new relay buffer for a chat session
function createRelayBuffer(chatId: number, verbosity: Verbosity): RelayBuffer {
  return {
    chatId,
    verbosity,
    textBuffer: "",
    lastFlush: Date.now(),
    flushTimer: null,
  };
}

interface RelayInfo {
  text: string | null;      // Text to relay to chat
  progress: string | null;  // Progress update (tool use, errors)
}

// Extract relay info from a stream event
function getRelayInfo(event: any): RelayInfo {
  const result: RelayInfo = { text: null, progress: null };

  switch (event.type) {
    case "assistant":
      // Claude CLI gives us complete messages, not deltas
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
      // Handle streaming deltas if they ever appear
      if (event.delta?.type === "text_delta") {
        result.text = event.delta.text;
      }
      break;

    case "error":
      result.progress = `Error: ${event.error?.message || 'Unknown error'}`;
      break;
  }

  return result;
}

async function handleEvent(event: Event): Promise<void> {
  log(`[Watcher] Processing: ${event.type} from ${event.source}`);
  log(`[Watcher] Payload: ${JSON.stringify(event.payload)}`);

  // Build prompt and session key based on event type
  let prompt: string;
  let sessionKey: string;

  // Track if we need to pass an image to Claude
  let imagePath: string | null = null;

  // Check for /new command to start fresh session
  let forceNewSession = false;

  // Relay buffer for streaming output to chat surfaces
  let relayBuffer: RelayBuffer | null = null;

  switch (event.type) {
    case "telegram:message":
      const { chat_id, from, text, verbosity: msgVerbosity } = event.payload as {
        chat_id: number;
        from: string;
        text: string;
        verbosity?: Verbosity;
      };

      // Default telegram to streaming verbosity
      relayBuffer = createRelayBuffer(chat_id, msgVerbosity || "streaming");

      sessionKey = `telegram-${chat_id}`;

      // Handle /new command
      if (text.trim().toLowerCase() === "/new") {
        clearSession(sessionKey);
        log(`[Watcher] Session cleared for ${sessionKey} via /new command`);
        // Send confirmation and return early - no need to invoke Claude
        const sendScript = path.join(PROJECT_ROOT, "integrations/telegram/src/send.ts");
        spawn("npx", ["tsx", sendScript, String(chat_id), "Fresh start, boss. New session is ready."], {
          cwd: PROJECT_ROOT,
          stdio: ["ignore", "ignore", "ignore"],
          detached: true,
        }).unref();
        return;
      }

      // Handle /restart command
      if (text.trim().toLowerCase() === "/restart") {
        log(`[Watcher] Restart requested via /restart command`);
        const sendScript = path.join(PROJECT_ROOT, "integrations/telegram/src/send.ts");
        spawn("npx", ["tsx", sendScript, String(chat_id), "Restarting... Back in a few seconds."], {
          cwd: PROJECT_ROOT,
          stdio: ["ignore", "ignore", "ignore"],
          detached: true,
        }).unref();
        // Trigger restart script in background (detached so it survives our death)
        spawn(path.join(PROJECT_ROOT, "restart.sh"), [], {
          cwd: PROJECT_ROOT,
          stdio: ["ignore", "ignore", "ignore"],
          detached: true,
        }).unref();
        return;
      }

      prompt = `[Telegram from ${from}]: ${text}`;
      break;

    case "telegram:photo":
      const { chat_id: photoChatId, from: photoFrom, caption, image_path, verbosity: photoVerbosity } = event.payload as {
        chat_id: number;
        from: string;
        caption: string;
        image_path: string;
        verbosity?: Verbosity;
      };

      sessionKey = `telegram-${photoChatId}`;
      relayBuffer = createRelayBuffer(photoChatId, photoVerbosity || "streaming");
      imagePath = image_path;
      prompt = caption
        ? `[Telegram photo from ${photoFrom}]: ${caption}\n\nIMPORTANT: User sent an image. Use the Read tool to view the image at: ${image_path}`
        : `[Telegram photo from ${photoFrom}]: User sent an image with no caption.\n\nIMPORTANT: Use the Read tool to view the image at: ${image_path}`;
      break;

    case "gmail:email":
      const { uid, from: emailFrom, to, subject, date, body, thread_id, message_id } = event.payload as {
        uid: number;
        from: string;
        to: string;
        subject: string;
        date: string;
        body: string;
        thread_id?: string;
        message_id?: string;
      };

      // Use thread_id if available, otherwise use subject as session key
      sessionKey = `email-${thread_id || subject.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 50)}`;

      // Create relay buffer for email with "final" verbosity (accumulate all, send once at end)
      relayBuffer = {
        chatId: null,
        verbosity: "final",
        textBuffer: "",
        lastFlush: Date.now(),
        flushTimer: null,
        email: {
          replyTo: emailFrom,
          subject: subject,
          threadId: thread_id,
          messageId: message_id,
        },
      };

      prompt = `[Email from ${emailFrom}]
Subject: ${subject}
Date: ${date}

${body}`;
      break;

    case "cron:job":
      const { job_id, job_description, job_prompt } = event.payload as {
        job_id: string;
        job_description: string;
        job_prompt: string;
      };

      sessionKey = `cron-${job_id}`;
      prompt = `[Scheduled Task: ${job_description}]\n\n${job_prompt}`;
      break;

    default:
      sessionKey = `event-${event.type}`;
      prompt = `[Event: ${event.type}] ${JSON.stringify(event.payload)}`;
  }

  // Generate deterministic UUID for this session (including generation counter)
  const generation = getSessionGeneration(sessionKey);
  const sessionId = generateSessionId(`${sessionKey}-gen${generation}`);
  const knownSessions = getKnownSessions();
  const isNewSession = !knownSessions.has(sessionId);

  // Extract telegram chat_id for relaying responses
  const telegramChatId = event.type === "telegram:message"
    ? (event.payload as { chat_id: number }).chat_id
    : null;

  // Spawn Claude to handle the event
  return new Promise((resolve, reject) => {
    log(`[Watcher] Spawning Claude with prompt: ${prompt.slice(0, 100)}...`);

    // Use --session-id for new sessions, --resume for existing
    const sessionArg = isNewSession
      ? ["--session-id", sessionId]
      : ["--resume", sessionId];

    log(`[Watcher] Session ${sessionId} (${isNewSession ? "new" : "resuming"})`);

    const proc = spawn(
      "claude",
      [
        ...sessionArg,
        "-p",
        "--verbose",
        "--output-format", "stream-json",
        "--dangerously-skip-permissions",
        prompt
      ],
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env, FORCE_COLOR: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";
    let lineBuffer = "";

    proc.stdout.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;
      lineBuffer += chunk;

      // Process complete lines (streaming JSON is newline-delimited)
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const streamEvent = JSON.parse(line);

          // Log every event to JSONL
          logStreamEvent(streamEvent);

          // Extract relay info and send to chat if applicable
          const { text, progress } = getRelayInfo(streamEvent);

          if (relayBuffer && text) {
            if (relayBuffer.verbosity === "streaming") {
              bufferText(relayBuffer, text);
            } else if (relayBuffer.verbosity === "final") {
              relayBuffer.textBuffer += text;
            }
          }
          if (relayBuffer && relayBuffer.verbosity === "progress" && progress && relayBuffer.chatId) {
            sendToTelegram(relayBuffer.chatId, progress);
          }
        } catch {
          // Not JSON, log raw line
          log(`[Stream] Non-JSON: ${line}`);
        }
      }
    });

    proc.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      fs.appendFileSync(LOG_FILE, "[stderr] " + chunk);
      process.stderr.write(chunk);
    });

    proc.on("close", (code) => {
      log(`[Watcher] Claude exited with code ${code}`);

      // Flush any remaining buffered text
      if (relayBuffer) {
        if (relayBuffer.flushTimer) {
          clearTimeout(relayBuffer.flushTimer);
          relayBuffer.flushTimer = null;
        }
        if (relayBuffer.textBuffer.trim()) {
          // Check if this is an email relay (send email reply) or Telegram relay
          if (relayBuffer.email) {
            sendEmailReply(relayBuffer.email.replyTo, relayBuffer.email.subject, relayBuffer.textBuffer.trim(), relayBuffer.email.threadId, relayBuffer.email.messageId);
          } else if (relayBuffer.chatId) {
            sendToTelegram(relayBuffer.chatId, relayBuffer.textBuffer.trim());
          }
        }
      }

      if (code !== 0) {
        log(`[Watcher] Claude error - stderr: ${stderr}`);
        reject(new Error(stderr));
      } else {
        log(`[Watcher] Claude finished handling event successfully`);
        if (isNewSession) {
          markSessionKnown(sessionId);
          log(`[Watcher] Marked session ${sessionId} as known`);
        }
        resolve();
      }
    });

    proc.on("error", (err) => {
      log(`[Watcher] Claude spawn error: ${err.message}`);
      reject(err);
    });
  });
}

async function pollOnce(): Promise<void> {
  // If already processing, mark that we need to poll again when done
  if (isProcessing) {
    pendingPoll = true;
    log("[Watcher] Already processing, will poll again when done");
    return;
  }

  isProcessing = true;
  pendingPoll = false;

  try {
    const events = getPendingEvents();

    for (const event of events) {
      try {
        markProcessed(event.id); // Mark first to prevent re-processing
        await handleEvent(event);
      } catch (error) {
        log(`[Watcher] Error handling event ${event.id}: ${error}`);
      }
    }
  } finally {
    isProcessing = false;

    // If new events came in while processing, poll again
    if (pendingPoll) {
      log("[Watcher] Processing queued poll...");
      setImmediate(() => pollOnce());
    }
  }
}

// Parse human-readable schedules to cron expressions
function parseSchedule(schedule: string): string {
  const lower = schedule.toLowerCase().trim();

  // Already a cron expression (contains spaces and looks like cron)
  if (/^[\d\*\/\-\,]+\s+[\d\*\/\-\,]+\s+[\d\*\/\-\,]+\s+[\d\*\/\-\,]+\s+[\d\*\/\-\,]+$/.test(schedule)) {
    return schedule;
  }

  // Human-readable patterns
  if (lower === "every minute") return "* * * * *";
  if (lower === "every hour") return "0 * * * *";
  if (lower === "every day" || lower === "daily") return "0 9 * * *";
  if (lower === "every week" || lower === "weekly") return "0 9 * * 1";

  // "every X minutes"
  const minMatch = lower.match(/^every (\d+) minutes?$/);
  if (minMatch) return `*/${minMatch[1]} * * * *`;

  // "every X hours"
  const hourMatch = lower.match(/^every (\d+) hours?$/);
  if (hourMatch) return `0 */${hourMatch[1]} * * *`;

  // "daily at Xam/pm" or "every day at X"
  const dailyAtMatch = lower.match(/(?:daily|every day) at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (dailyAtMatch) {
    let hour = parseInt(dailyAtMatch[1]);
    const minute = dailyAtMatch[2] ? parseInt(dailyAtMatch[2]) : 0;
    const ampm = dailyAtMatch[3];
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    return `${minute} ${hour} * * *`;
  }

  // "at Xam/pm" (daily)
  const atMatch = lower.match(/^at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (atMatch) {
    let hour = parseInt(atMatch[1]);
    const minute = atMatch[2] ? parseInt(atMatch[2]) : 0;
    const ampm = atMatch[3];
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    return `${minute} ${hour} * * *`;
  }

  // Return as-is if no match (assume it's a cron expression)
  return schedule;
}

function loadCronConfig(): CronConfig {
  try {
    if (fs.existsSync(CRON_CONFIG_FILE)) {
      const content = fs.readFileSync(CRON_CONFIG_FILE, "utf-8");
      return JSON.parse(content);
    }
  } catch (err) {
    log(`[Cron] Error loading config: ${err}`);
  }
  return { jobs: [] };
}

function saveCronConfig(config: CronConfig): void {
  fs.writeFileSync(CRON_CONFIG_FILE, JSON.stringify(config, null, 2));
}

function deleteJob(jobId: string): void {
  const config = loadCronConfig();
  const index = config.jobs.findIndex((j) => j.id === jobId);
  if (index !== -1) {
    config.jobs.splice(index, 1);
    saveCronConfig(config);
    log(`[Cron] Deleted one-off job: ${jobId}`);
  }
}

function scheduleCronJobs(): void {
  // Stop all existing cron tasks
  for (const [id, task] of activeCronTasks) {
    task.stop();
    log(`[Cron] Stopped job: ${id}`);
  }
  activeCronTasks.clear();

  // Clear all existing timeouts
  for (const [id, timeout] of activeTimeouts) {
    clearTimeout(timeout);
    log(`[Cron] Cleared timeout: ${id}`);
  }
  activeTimeouts.clear();

  const config = loadCronConfig();
  let recurringCount = 0;
  let oneOffCount = 0;

  for (const job of config.jobs) {
    if (!job.enabled) {
      log(`[Cron] Skipping disabled job: ${job.id}`);
      continue;
    }

    // Handle one-off tasks with run_at
    if (job.run_once && job.run_at) {
      const runAt = new Date(job.run_at);
      const now = new Date();
      const delayMs = runAt.getTime() - now.getTime();

      if (delayMs <= 0) {
        // Already past, run immediately and delete
        log(`[Cron] One-off job ${job.id} is past due, running now`);
        pushEvent("cron:job", "cron", {
          job_id: job.id,
          job_description: job.description,
          job_prompt: job.prompt,
          run_once: true,
        });
        deleteJob(job.id);
      } else {
        // Schedule for future
        const timeout = setTimeout(() => {
          log(`[Cron] Triggering one-off job: ${job.id} (${job.description})`);
          pushEvent("cron:job", "cron", {
            job_id: job.id,
            job_description: job.description,
            job_prompt: job.prompt,
            run_once: true,
          });
          deleteJob(job.id);
          activeTimeouts.delete(job.id);
        }, delayMs);

        activeTimeouts.set(job.id, timeout);
        const mins = Math.round(delayMs / 60000);
        log(`[Cron] Scheduled one-off job: ${job.id} to run in ${mins} minutes`);
        oneOffCount++;
      }
      continue;
    }

    // Handle recurring cron jobs
    const cronExpression = parseSchedule(job.schedule);

    if (!cron.validate(cronExpression)) {
      log(`[Cron] Invalid schedule for job ${job.id}: ${job.schedule} -> ${cronExpression}`);
      continue;
    }

    const task = cron.schedule(cronExpression, () => {
      log(`[Cron] Triggering job: ${job.id} (${job.description})`);
      pushEvent("cron:job", "cron", {
        job_id: job.id,
        job_description: job.description,
        job_prompt: job.prompt,
      });
    });

    activeCronTasks.set(job.id, task);
    log(`[Cron] Scheduled job: ${job.id} with schedule "${job.schedule}" -> "${cronExpression}"`);
    recurringCount++;
  }

  log(`[Cron] ${recurringCount} recurring jobs, ${oneOffCount} one-off tasks scheduled`);
}

async function watch(): Promise<void> {
  log("[Watcher] Starting event watcher...");
  log(`[Watcher] Monitoring: ${PENDING_DIR}`);
  log(`[Watcher] Logging to: ${LOG_FILE}`);

  // Initialize cron jobs
  scheduleCronJobs();

  // Watch cron config for changes
  if (fs.existsSync(CRON_CONFIG_FILE)) {
    fs.watch(path.dirname(CRON_CONFIG_FILE), (eventType, filename) => {
      if (filename === "cron.json") {
        log("[Cron] Config file changed, reloading...");
        scheduleCronJobs();
      }
    });
  }

  // Initial poll
  await pollOnce();

  // Watch for new files
  fs.watch(PENDING_DIR, async (eventType, filename) => {
    if (filename?.endsWith(".json")) {
      // Small delay to ensure file is fully written
      await new Promise((r) => setTimeout(r, 100));
      await pollOnce();
    }
  });

  // Backup polling in case fs.watch misses something
  setInterval(pollOnce, POLL_INTERVAL * 10);

  log("[Watcher] Ready and waiting for events...");
}

watch().catch((err) => {
  log(`[Watcher] Fatal error: ${err}`);
  process.exit(1);
});
